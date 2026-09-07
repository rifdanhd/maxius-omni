#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
MSG="${1:-upd}"

if git diff --quiet && git diff --cached --quiet; then
  echo "-> Tidak ada perubahan, langsung push."
else
  git add -A
  git commit -m "$MSG"
fi
git push
echo "-> OK: perubahan sudah di-push ke origin/main."