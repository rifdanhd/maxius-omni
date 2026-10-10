/**
 * Dev server E2E dengan database Postgres TERISOLASI.
 *
 * Kenapa: spec e2e menulis fixture (produk, toko, promosi) langsung lewat psql.
 * Bila dev server memakai `maxius_dev`, fixture e2e bercampur dengan data
 * developer — dan sebelumnya pernah meninggalkan sisa data. Sekarang tiap run
 * Playwright memakai DB `maxius_test_e2e_*` sendiri:
 *
 *   1. setupTestDb()  → CREATE DATABASE + `prisma migrate deploy`
 *   2. node prisma/seed.js → admin tes + 5 brand + data seed
 *   3. tulis marker `.e2e-db.json` (dibaca spec & global setup/teardown)
 *   4. `next dev -p 3100` dengan POSTGRES_URL DB tsb
 *
 * Saat proses di-stop (Playwright membunuh webServer) → drop DB + hapus marker.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupTestDb } from "./lib/test-db";
import { TEST_ADMIN_PASSWORD } from "./lib/e2e-credentials";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MARKER = path.join(ROOT, ".e2e-db.json");
const PORT = "3100";
process.env.TEST_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
process.env.APP_ORIGIN = `http://localhost:${PORT}`;
process.env.AUTO_SYNC_DISABLED = "true";
process.env.SYNC_RETRY_DISABLED = "true";

const db = setupTestDb("e2e");
console.log(`[e2e-dev] database terisolasi: ${db.name}`);

console.log("[e2e-dev] seeding (prisma/seed.js)...");
execSync("node prisma/seed.js", {
  cwd: ROOT,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, POSTGRES_URL: db.url, DATABASE_URL: db.url },
});

fs.writeFileSync(MARKER, JSON.stringify({ name: db.name, url: db.url, port: PORT }) + "\n");

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "-p", PORT], {
  cwd: ROOT,
  stdio: "inherit",
  // MAXIUS_E2E=1 → next.config.ts memakai distDir ".next-e2e" supaya lockfile
  // dev server e2e tidak bentrok dengan `npm run dev` (Next 16: 1 lock/dir).
  env: { ...process.env, POSTGRES_URL: db.url, DATABASE_URL: db.url, MAXIUS_E2E: "1" },
});

let stopping = false;
function shutdown(code: number): void {
  if (stopping) return;
  stopping = true;
  try {
    child.kill("SIGTERM");
  } catch {
    /* sudah mati */
  }
  try {
    fs.rmSync(MARKER, { force: true });
  } catch {
    /* ignore */
  }
  db.cleanup();
  process.exit(code);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
child.on("exit", (code) => shutdown(code ?? 0));
