import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Pastikan database e2e tidak tertinggal. Run Playwright = satu DB
 * (maxius_test_e2e_*), dibuang di sini dan juga oleh shutdown handler
 * scripts/e2e-dev.mts — keduanya idempoten (DROP ... IF EXISTS).
 */
export default async function globalTeardown(): Promise<void> {
  const marker = path.resolve(__dirname, '..', '.e2e-db.json');
  try {
    if (fs.existsSync(marker)) {
      const info = JSON.parse(fs.readFileSync(marker, 'utf8')) as { name?: string };
      if (info.name && /^maxius_test_e2e_/.test(info.name)) {
        execSync(
          `psql postgresql://udan@localhost:5432/postgres -c "DROP DATABASE IF EXISTS \\"${info.name}\\" WITH (FORCE)"`,
          { stdio: 'ignore' }
        );
      }
      fs.rmSync(marker, { force: true });
    }
  } catch {
    /* sweeper test-db.ts (>1 jam) akan memungut sisa */
  }
}
