import fs from 'fs';
import path from 'path';
import type { FullConfig } from '@playwright/test';

/**
 * webServer (scripts/e2e-dev.mts) sudah start duluan sebelum globalSetup,
 * jadi di sini kita tinggal memastikan marker DB sudah ada & bisa dipakai spec.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const marker = path.resolve(__dirname, '..', '.e2e-db.json');
  if (!fs.existsSync(marker)) {
    throw new Error(
      '.e2e-db.json tidak ada — webServer e2e-dev.mts gagal membuat database. Lihat log webServer.'
    );
  }
  const info = JSON.parse(fs.readFileSync(marker, 'utf8')) as { name: string };
  if (!/^maxius_test_e2e_/.test(info.name)) {
    throw new Error(`DB e2e tidak valid: ${info.name}`);
  }
}
