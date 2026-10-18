import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { dbInfo } from './helpers';

/**
 * Pastikan database e2e tidak tertinggal. Run Playwright = satu DB
 * (maxius_test_e2e_*), dibuang di sini dan juga oleh shutdown handler
 * scripts/e2e-dev.mts — keduanya idempoten (DROP ... IF EXISTS).
 */
export default async function globalTeardown(): Promise<void> {
  const marker = path.resolve(__dirname, '..', '.e2e-db.json');
  try {
    if (fs.existsSync(marker)) {
      const info = dbInfo();
      const adminUrl = new URL(info.url);
      adminUrl.pathname = '/postgres';
      if (info.name) {
        execFileSync(
          'psql', [adminUrl.href, '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS "${info.name}" WITH (FORCE)`],
          { stdio: 'ignore' }
        );
      }
      fs.rmSync(marker, { force: true });
    }
  } catch {
    /* Shutdown server pengujian juga membersihkan database milik sesi ini. */
  }
}
