/**
 * Fixture DB Postgres terisolasi untuk test integration.
 *
 * Schema project kini `provider = "postgresql"` (env `POSTGRES_URL`) — pola lama
 * yang men-set `DATABASE_URL` ke file SQLite SUDAH MATI: Prisma mengabaikannya
 * dan test diam-diam jalan melawan `maxius_dev`, sehingga fixture bentrok
 * (P2002) atau assertion membaca data sisa run sebelumnya.
 *
 * Pakai:
 *   import { setupTestDb } from "@/scripts/lib/test-db";
 *   const db = setupTestDb("phase-a");      // SEBELUM import "@/lib/db/prisma"
 *   ...
 *   db.cleanup();                            // opsional — juga jalan saat process exit
 *
 * `DATABASE_URL` ikut diset ke URL pg yang sama supaya kode lama yang masih
 * membaca DATABASE_URL ikut benar.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ADMIN_DB_NAME = "postgres";
const LEGACY_DEFAULT_ADMIN = "postgresql://udan@localhost:5432/maxius_dev";
const STALE_MS = 60 * 60 * 1000;

function parseEnvFile(file: string, key: string): string | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || m[1] !== key) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return undefined;
}

function withPath(url: string, dbName: string): string {
  const qIndex = url.indexOf("?");
  const query = qIndex >= 0 ? url.slice(qIndex) : "";
  const head = qIndex >= 0 ? url.slice(0, qIndex) : url;
  const cut = head.lastIndexOf("/");
  if (cut < 0) return `${url}/${dbName}`;
  return `${head.slice(0, cut + 1)}${dbName}${query}`;
}

/** URL koneksi admin — CREATE/DROP DATABASE perintah server-wide, db-nya bebas. */
function adminUrl(): string {
  const fromEnv = process.env.POSTGRES_URL ?? process.env.POSTGRES_ADMIN_URL;
  if (fromEnv) return withPath(fromEnv, ADMIN_DB_NAME);
  const fromFile = parseEnvFile(path.join(process.cwd(), ".env"), "POSTGRES_URL");
  if (fromFile) return withPath(fromFile, ADMIN_DB_NAME);
  return LEGACY_DEFAULT_ADMIN;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function runSql(url: string, statement: string): string {
  return execSync(`npx prisma db execute --url=${JSON.stringify(url)} --stdin`, {
    input: statement,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export interface TestDb {
  name: string;
  url: string;
  cleanup: () => void;
}

/**
 * Buat database Postgres kosong khusus test + `prisma migrate deploy`.
 * Nama unik per proses; sisa database dari run yang crash dibuang otomatis
 * bila sudah lebih dari 1 jam.
 */
export function setupTestDb(prefix: string, options: { migrate?: boolean } = {}): TestDb {
  const admin = adminUrl();
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 24);
  const name = `maxius_test_${safePrefix}_${Date.now().toString(36)}_${process.pid}`;
  const url = withPath(admin, name);

  dropStaleTestDatabases(admin);

  runSql(admin, `CREATE DATABASE ${quoteIdent(name)}`);

  process.env.POSTGRES_URL = url;
  process.env.DATABASE_URL = url;

  if (options.migrate !== false) {
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, POSTGRES_URL: url, DATABASE_URL: url },
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    try {
      runSql(admin, `DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
    } catch {
      /* koneksi sudah tutup / db sudah hilang — biarkan */
    }
  };

  process.once("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  return { name, url, cleanup };
}

/** Buang database sisa run sebelumnya yang lebih tua dari STALE_MS. */
function dropStaleTestDatabases(admin: string): void {
  let rows: string[] = [];
  try {
    rows = execSync(
      `psql ${JSON.stringify(admin)} -Atc ` +
        JSON.stringify(
          `SELECT datname FROM pg_database WHERE datname LIKE 'maxius_test_%'`
        ),
      { encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    return; // psql tidak tersedia → lewati sweeping
  }

  const now = Date.now();
  for (const dbName of rows) {
    const stamp = dbName.match(/_([0-9a-z]+)_(\d+)$/);
    if (!stamp) continue;
    const ts = Number.parseInt(stamp[1], 36);
    if (!Number.isFinite(ts) || now - ts < STALE_MS) continue;
    try {
      runSql(admin, `DROP DATABASE IF EXISTS ${quoteIdent(dbName)} WITH (FORCE)`);
    } catch {
      /* skip */
    }
  }
}
