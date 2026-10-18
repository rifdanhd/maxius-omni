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
import { spawn, execSync, execFileSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupTestDb } from "./lib/test-db";
import { TEST_ADMIN_PASSWORD } from "./lib/e2e-credentials";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MARKER = path.join(ROOT, ".e2e-db.json");
const PORT = "3100";
const production = process.env.E2E_SERVER_MODE === "production";
let tlsProxy: https.Server | undefined;
process.env.TEST_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
process.env.APP_ORIGIN = `${production ? "https" : "http"}://localhost:${PORT}`;
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

if (production) {
  const tlsDir = path.join(ROOT, ".next-e2e", "qa", "tls");
  fs.mkdirSync(tlsDir, { recursive: true });
  const key = path.join(tlsDir, "localhost.key.pem");
  const cert = path.join(tlsDir, "localhost.cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-days", "1"], { stdio: "ignore" });
  tlsProxy = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (incoming, outgoing) => {
    const upstream = http.request({ hostname: "127.0.0.1", port: 3101, method: incoming.method, path: incoming.url, headers: incoming.headers }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", () => { outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    tlsProxy!.once("error", reject);
    tlsProxy!.listen(Number(PORT), "localhost", resolve);
  });
}

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...(production ? ["start", "-H", "127.0.0.1"] : ["dev", "--webpack"]), "-p", production ? "3101" : PORT], {
  cwd: ROOT,
  stdio: "inherit",
  // MAXIUS_E2E=1 → next.config.ts memakai distDir ".next-e2e" supaya lockfile
  // dev server e2e tidak bentrok dengan `npm run dev` (Next 16: 1 lock/dir).
  env: { ...process.env, POSTGRES_URL: db.url, DATABASE_URL: db.url, MAXIUS_E2E: production ? "0" : "1", NODE_ENV: production ? "production" : "development" },
});
fs.writeFileSync(MARKER, JSON.stringify({ name: db.name, url: db.url, port: PORT, origin: process.env.APP_ORIGIN }) + "\n");

let stopping = false;
function shutdown(code: number): void {
  if (stopping) return;
  stopping = true;
  tlsProxy?.closeAllConnections();
  tlsProxy?.close();
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
