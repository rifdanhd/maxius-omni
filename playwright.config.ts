import { defineConfig } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Konfigurasi e2e ./e2e.
 *
 * DB & server: `scripts/e2e-dev.mts` membuat database Postgres terisolasi
 * (maxius_test_e2e_*), me-seed-nya, lalu menjalankan `next dev -p 3100`
 * dengan POSTGRES_URL ke DB tsb. Spec membaca URL tsb dari `.e2e-db.json`.
 * Jadi tiap run e2e mulai dari DB bersih dan TIDAK menyentuh `maxius_dev`.
 */
const ROOT = __dirname;
const MARKER = path.join(ROOT, '.e2e-db.json');
const PORT = 3100;

/** Run sebelumnya yang crash bisa meninggalkan server + DB sisa di port 3100. */
function cleanupStalePreviousRun(): void {
  // Config ini juga di-load di PROSES WORKER (Playwright memuat config di tiap
  // worker). Tanpa guard ini, worker yang spawn belakangan akan menganggap
  // server webServer yang SEDANG HIDUP sebagai sisa run lama → kill -9 →
  // seluruh run dibunuh. Hanya proses utama yang boleh bersih-bersih.
  if (process.env.TEST_WORKER_INDEX !== undefined || process.env.JEST_WORKER_ID !== undefined) {
    return;
  }
  if (!fs.existsSync(MARKER)) return;
  try {
    const stale = JSON.parse(fs.readFileSync(MARKER, 'utf8')) as { name?: string };
    const pids = execSync('lsof -ti tcp:' + PORT + ' || true', { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const pid of pids) {
      try {
        execSync('kill -9 ' + pid, { stdio: 'ignore' });
      } catch {
        /* proses sudah mati */
      }
    }
    if (stale.name && /^maxius_test_e2e_/.test(stale.name)) {
      execSync(
        `psql postgresql://udan@localhost:5432/postgres -c "DROP DATABASE IF EXISTS \\"${stale.name}\\" WITH (FORCE)"`,
        { stdio: 'ignore' }
      );
    }
  } catch {
    /* bersih-bersih gagal → biarkan, jangan gagalkan run */
  } finally {
    fs.rmSync(MARKER, { force: true });
  }
}

cleanupStalePreviousRun();

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    extraHTTPHeaders: { Origin: `http://localhost:${PORT}` },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx tsx scripts/e2e-dev.mts',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
