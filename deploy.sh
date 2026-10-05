#!/usr/bin/env bash
#
# deploy.sh — deploy maxius-platform ke VPS (systemd: maxius-omni.service).
#
# Pemakaian (sebagai user aplikasi, BUKAN root; sudoers sempit lihat runbook §1):
#   ./deploy.sh
# Variabel:
#   DEPLOY_BRANCH=main    branch yang dideploy
#   EXPECTED_REMOTE=...   remote wajib (default: repo maxius-omni)
#   SWAP_MB=4096          ukuran swapfile bila swap belum ada (SEBELUM build)
#   SKIP_MIGRATE=1        lewati prisma migrate deploy
#   SKIP_BACKUP=1         lewati pg_dump pre-deploy (TIDAK disarankan)
#   SKIP_BUILD=1          lewati npm run build (jarang)
#
# Urutan aman (tiap langkah gagal → berhenti, tidak ada state setengah jalan):
#   1 preflight env (NAMA variable saja, nilai tidak pernah dicetak)
#   1c preflight git: remote origin HARUS sama dgn repo asal + branch sesuai
#   2 swap  (RAM 1.9GB — swap DIBUAT SEBELUM build agar build tidak OOM)
#   3 fetch → tolak bila ada commit lokal belum di-push → pull --ff-only
#   4 npm ci → 5 pg_dump backup DB → 6 prisma migrate deploy
#   7 backup .next → build --webpack → 8 systemctl restart maxius-omni
#   9 health check 127.0.0.1:3000 → 10 verifikasi log [SyncRetry]
#
# Rollback build: hentikan service, pindahkan .next baru, salin .next.bak
# ke .next, lalu hidupkan service. Tidak perlu menjalankan deploy/build lagi.
set -euo pipefail
cd "$(dirname "$0")"

BRANCH="${DEPLOY_BRANCH:-main}"
# Repo asal maxius-platform (lokal & VPS) — remote LAIN = ditolak.
EXPECTED_REMOTE="${EXPECTED_REMOTE:-https://github.com/rifdanhd/maxius-omni.git}"
SWAP_MB="${SWAP_MB:-4096}"
SVC="maxius-omni"
HEALTH_URL="http://127.0.0.1:3000/"
STALE_ENV_WARN=()

log() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '\nGAGAL: %s\n' "$*" >&2; exit 1; }

# ── 0. Kemampuan sudo SEMPIT (restart/journalctl maxius-omni) — cek di AWAL ─
# sudoers yang dipakai HANYA: systemctl restart|status maxius-omni,
# journalctl -u maxius-omni * (lihat runbook §1) — sudo lain tidak ada.
SYSTEMCTL=""
JOURNAL=""
if [ "$(id -u)" -eq 0 ]; then
  SYSTEMCTL="systemctl"
  JOURNAL="journalctl"
elif command -v sudo >/dev/null 2>&1 &&
  sudo -n -l 2>/dev/null | grep -q 'systemctl restart maxius-omni'; then
  SYSTEMCTL="sudo -n systemctl"
  JOURNAL="sudo -n journalctl"
else
  log "PERINGATAN: sudo sempit utk restart maxius-omni tidak ditemukan — build tetap jalan,"
  log "  restart akan diminta manual di akhir (pasang sudoers: runbook §1 step 7)."
fi

# ── 1. Preflight .env (hanya NAMA; nilai tidak pernah dicetak) ───────────────
log "Preflight .env"
[ -f .env ] || die ".env tidak ada di $(pwd) — salin & isi di server (lihat runbook)"

missing=()
for v in JWT_SECRET PII_ENC_KEY; do
  grep -qE "^${v}=.+" .env || missing+=("$v")
done
if ! grep -qE '^(POSTGRES_URL|DATABASE_URL)=.+' .env; then
  missing+=("POSTGRES_URL|DATABASE_URL")
fi
if [ "${#missing[@]}" -gt 0 ]; then
  printf '  env wajib kosong: %s\n' "${missing[*]}" >&2
  die "isi dulu di server (jangan kirim nilainya ke chat) — lihat checklist runbook"
fi

warn_missing=()
for v in SHOPEE_PARTNER_ID SHOPEE_PARTNER_KEY SHOPEE_REDIRECT_URI \
         TIKTOK_APP_KEY TIKTOK_APP_SECRET TIKTOK_REDIRECT_URI TIKTOK_SERVICE_ID TIKTOK_AUTHORIZE_URL WEBHOOK_BASE_URL; do
  grep -qE "^${v}=.+" .env || warn_missing+=("$v")
done
[ "${#warn_missing[@]}" -gt 0 ] && log "PERINGATAN non-fatal — env belum diisi: ${warn_missing[*]}"

# Kondisi nilai yang terlihat publik/aman-divalidasi (bukan rahasia):
grep -qE '^TIKTOK_REDIRECT_(URI|URL)=.*vercel\.app' .env 2>/dev/null &&
  STALE_ENV_WARN+=("TIKTOK_REDIRECT_URI/URL masih menunjuk vercel.app — ganti ke https://maxius.id/...")
grep -qE '^WEBHOOK_BASE_URL=.*ngrok' .env 2>/dev/null &&
  STALE_ENV_WARN+=("WEBHOOK_BASE_URL masih ngrok — ganti ke https://maxius.id")
env_port="$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2- | tr -d '"'\'' ' || true)"
if [ -n "$env_port" ] && [ "$env_port" != "3000" ]; then
  STALE_ENV_WARN+=("PORT di .env = ${env_port}, tapi unit systemd memakai -p 3000 — samakan (unit memaksa 3000)")
fi
for w in "${STALE_ENV_WARN[@]:-}"; do
  [ -n "$w" ] && log "PERINGATAN: $w"
done

# ── 1b. Bentrok pm2 — hanya BERBAHAYA bila pm2 memegang port 3000 ────────────
# (pm2 boleh tetap jalan utk app LAIN di port lain — mis. "lembur online" :3001;
#  yang ditolak hanya bila salah satu proses pm2 memegang port 3000 = milik
#  maxius-omni → restart systemd pasti bentrok.)
if command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | grep -q '"name"'; then
  pm2_pids="$(pm2 jlist 2>/dev/null | grep -oE '"pid":[0-9]+' | cut -d: -f2 | sort -u)"
  port3000_pids="$(ss -ltnpH 'sport = :3000' 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  conflict_pid=""
  for p in $port3000_pids; do
    if printf '%s\n' "$pm2_pids" | grep -qx "$p"; then conflict_pid="$p"; fi
  done
  if [ -n "$conflict_pid" ]; then
    die "pm2 memegang port 3000 (pid ${conflict_pid}) — bentrok dgn systemd maxius-omni.
  Matikan app pm2 itu saja dulu (pm2 delete <nama>), atau matikan sepenuhnya:  pm2 kill"
  fi
  log "pm2 aktif tapi TIDAK memegang port 3000 — aman, diabaikan"
fi

# ── 1c. Preflight git: remote origin HARUS repo asal maxius-platform ─────────
# (clone VPS dibuat dari remote yang SAMA dgn maxius-platform lokal —
#  remote lain / branch salah / detached HEAD → ditolak sebelum swap/build.)
norm_remote() {
  local u="$1"
  u="${u%.git}"
  case "$u" in
    https://* | http://*) u="${u#*://}" ;;
    git@*:*) u="${u#git@}"; u="${u%%:*}/${u#*:}" ;; # git@host:path → host/path
  esac
  printf '%s' "$u"
}
origin_url="$(git remote get-url origin 2>/dev/null || true)"
[ -n "$origin_url" ] || die "remote 'origin' tidak ada — repo ini bukan clone maxius-omni. Clone ulang:  git clone https://github.com/rifdanhd/maxius-omni.git"
if [ "$(norm_remote "$origin_url")" != "$(norm_remote "$EXPECTED_REMOTE")" ]; then
  die "remote origin tidak sesuai repo asal:
  origin   = ${origin_url}
  diharapkan = ${EXPECTED_REMOTE}
  (JANGAN deploy dari clone ini — pindah ke clone maxius-omni asli, atau set EXPECTED_REMOTE bila memang fork)"
fi
current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo DETACHED)"
[ "$current_branch" = "$BRANCH" ] ||
  die "branch aktif '${current_branch}' ≠ branch deploy '${BRANCH}' — git checkout ${BRANCH} dulu"
log "Preflight git OK — origin $(norm_remote "$origin_url") @ ${BRANCH}"

# ── 2. Swap SEBELUM build (RAM 1.9GB) ────────────────────────────────────────
ensure_swap() {
  local cur_kb
  cur_kb="$(awk '/^SwapTotal:/{print $2}' /proc/meminfo)"
  if [ "${cur_kb:-0}" -ge 1048576 ]; then
    log "Swap cukup: $((cur_kb / 1024))MB"
    return
  fi
  log "Swap < 1GB — membuat /swapfile ${SWAP_MB}M SEBELUM build"
  local sudo_cmd=""
  if [ "$(id -u)" -eq 0 ]; then
    sudo_cmd=""
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo_cmd="sudo -n"
  else
    die "swap belum ada & tidak bisa sudo. Buat manual dulu:
  sudo fallocate -l ${SWAP_MB}M /swapfile && sudo chmod 600 /swapfile \\
  && sudo mkswap /swapfile && sudo swapon /swapfile \\
  && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
  fi
  if [ ! -f /swapfile ]; then
    $sudo_cmd fallocate -l "${SWAP_MB}M" /swapfile ||
      $sudo_cmd dd if=/dev/zero of=/swapfile bs=1M count="$SWAP_MB" status=progress
  fi
  $sudo_cmd chmod 600 /swapfile
  $sudo_cmd mkswap /swapfile >/dev/null
  $sudo_cmd swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab ||
    echo '/swapfile none swap sw 0 0' | $sudo_cmd tee -a /etc/fstab >/dev/null
  log "Swap aktif: $(( $(awk '/^SwapTotal:/{print $2}' /proc/meminfo) / 1024 ))MB"
}
ensure_swap

# ── 3. Fetch → tolak commit lokal tak ter-push → pull --ff-only ──────────────
log "git fetch origin"
git fetch origin
if ! git rev-parse --verify --quiet "origin/${BRANCH}" >/dev/null; then
  die "origin/${BRANCH} tidak ditemukan di remote — push dulu dari mesin lokal"
fi
ahead="$(git rev-list --count "origin/${BRANCH}..HEAD")"
if [ "${ahead:-0}" -gt 0 ]; then
  die "ada ${ahead} commit lokal yang BELUM di-push ke origin/${BRANCH} (drift — VPS akan membangun kode yang tak ada di remote).
Push dulu SEMUA commit F0..F3 dari mesin lokal:
  git push origin ${BRANCH}
lalu jalankan deploy.sh lagi."
fi
log "git pull --ff-only origin ${BRANCH}"
git pull --ff-only origin "${BRANCH}"

# ── 4. Install dependensi (postinstall → prisma generate) ────────────────────
log "npm ci"
npm ci --no-audit --no-fund ||
  die "npm ci gagal — package-lock.json mungkin sinkron dengan package.json; cek output"

# ── 5. Backup DB SEBELUM migrate (pg_dump → backups/, rotasi 5 terakhir) ─────
# Gagal dump = deploy berhenti; migrate TIDAK jalan tanpa backup.
if [ "${SKIP_BACKUP:-0}" != "1" ]; then
  log "pg_dump backup pre-deploy"
  command -v pg_dump >/dev/null 2>&1 ||
    die "pg_dump tidak ada — install client dulu:  sudo dnf install -y postgresql  (atau apt install postgresql-client)"
  db_url="$(grep -E '^(POSTGRES_URL|DATABASE_URL)=' .env | tail -1 | cut -d= -f2- | tr -d '"'\'' ')"
  db_url="${db_url%%\?*}"   # buang query string (?sslmode=…) — pg_dump terima URI polos
  [ -n "$db_url" ] || die "POSTGRES_URL/DATABASE_URL kosong — backup dibatalkan"
  mkdir -p backups
  backup="backups/pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
  if ! pg_dump "$db_url" | gzip >"$backup" || [ ! -s "$backup" ]; then
    rm -f "$backup"
    die "pg_dump gagal — migrate DIBATALKAN (backup: runbook §3/§6)"
  fi
  log "backup OK: ${backup} ($(du -h "$backup" | cut -f1)) — restore: runbook §6"
  ls -1t backups/pre-deploy-*.sql.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
else
  log "SKIP_BACKUP=1 — backup DB dilewati (TIDAK disarankan)"
fi

# ── 6. Migrate SEBELUM build (skema basi jangan sampai ter-build) ─────────────
if [ "${SKIP_MIGRATE:-0}" != "1" ]; then
  log "prisma migrate deploy"
  npx prisma migrate deploy
fi

# ── 7. Build ─────────────────────────────────────────────────────────────────
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  [ ! -L .next ] && [ ! -L .next.bak ] || die ".next/.next.bak tidak boleh berupa symlink"
  build_backup_created=0
  build_backup_tag="$(date +%Y%m%d-%H%M%S)-$$"
  if [ -s .next/BUILD_ID ]; then
    build_backup_tmp=".next.bak.tmp.${build_backup_tag}"
    [ ! -e "$build_backup_tmp" ] || die "direktori backup sementara sudah ada"
    log "salin build lama ke .next.bak sebelum build baru"
    cp -a -- .next "$build_backup_tmp"
    if [ -e .next.bak ]; then
      [ ! -e ".next.bak.${build_backup_tag}" ] || die "arsip backup sudah ada"
      mv -- .next.bak ".next.bak.${build_backup_tag}"
    fi
    mv -- "$build_backup_tmp" .next.bak
    build_backup_created=1
  else
    log "Tidak ada build produksi lama (BUILD_ID); backup dilewati"
  fi
  export NEXT_TELEMETRY_DISABLED=1
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
  log "NEXT_PUBLIC_ENABLE_OFFICE=false npm run build -- --webpack  (NODE_OPTIONS=${NODE_OPTIONS})"
  if NEXT_PUBLIC_ENABLE_OFFICE=false npm run build -- --webpack; then
    :
  else
    if [ "$build_backup_created" = "1" ]; then
      if [ -e .next ]; then
        mv -- .next ".next.failed.${build_backup_tag}"
      fi
      cp -a -- .next.bak .next
      log "Build gagal; .next lama dipulihkan, .next.bak tetap tersedia"
    fi
    die "build gagal — service tidak direstart"
  fi
else
  log "SKIP_BUILD=1 — build dilewati"
fi

# ── 8. Restart service ───────────────────────────────────────────────────────
if [ -n "$SYSTEMCTL" ]; then
  log "restart ${SVC}"
  $SYSTEMCTL restart "$SVC"
else
  printf '\nBuild selesai. Restart MANUAL (sudoers sempit mengizinkan):\n  sudo systemctl restart %s\n  sudo journalctl -u %s --since "-5 min" | grep SyncRetry\n' "$SVC" "$SVC"
  exit 1
fi

# ── 9. Health check ──────────────────────────────────────────────────────────
log "health check ${HEALTH_URL}"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 3 "$HEALTH_URL"; then
    ok=1
    break
  fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  "$JOURNAL" -u "$SVC" -n 40 --no-pager || true
  die "service tidak sehat (log journal di atas)"
fi

# ── 10. Verifikasi instrumentation (auto-retry SyncJob) ───────────────────────
if [ -n "$JOURNAL" ] && "$JOURNAL" -u "$SVC" --since "-5 min" --no-pager 2>/dev/null |
  grep -qF '[SyncRetry] auto-retry SyncJob aktif'; then
  log "instrumentation OK — [SyncRetry] auto-retry SyncJob aktif"
else
  log "PERINGATAN: log [SyncRetry] tidak ditemukan — cek: sudo journalctl -u ${SVC} | grep SyncRetry"
  log "  (syarat: NODE_ENV=production di unit; SYNC_RETRY_DISABLED≠true)"
fi

log "DEPLOY SELESAI — $(git rev-parse --short HEAD) on ${BRANCH}"
