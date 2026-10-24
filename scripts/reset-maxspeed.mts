import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const target = {
  id: "cmus674za00g5ezfjtm65451v",
  businessId: "business-default",
  externalShopId: "7495918791259228955",
};
const execute = process.argv.includes("--execute");
const db = new PrismaClient();

try {
  const account = await db.platformAccount.findUnique({
    where: { id: target.id },
    select: { id: true, label: true, platform: true, businessId: true, externalShopId: true,
      _count: { select: { orders: true, productMapping: true } } },
  });
  if (!account) {
    console.log("Akun Maxspeed target sudah tidak ada. Tidak ada data yang diubah.");
  } else {
    if (account.platform !== "TIKTOK_SHOP" || account.businessId !== target.businessId ||
        account.externalShopId !== target.externalShopId || account.label !== "Maxspeed Indonesia") {
      throw new Error("Identitas akun tidak sesuai target; operasi dibatalkan.");
    }
    console.table([{ id: account.id, toko: account.label,
      pesanan: account._count.orders, mapping: account._count.productMapping }]);
    if (!execute) {
      console.log("Pratinjau saja. Gunakan --execute untuk backup, atur 90 hari, lalu hapus akun target.");
    } else {
      process.umask(0o077);
      const connection = new URL(process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? "");
      if (!["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname)) {
        throw new Error("Skrip ini hanya untuk database PostgreSQL lokal VPS.");
      }
      const backupDir = path.resolve("backups");
      mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backup = path.join(backupDir, `before-reset-maxspeed-${stamp}.dump`);
      const backupEnv = {
        ...process.env,
        PGHOST: connection.hostname,
        PGPORT: connection.port || "5432",
        PGUSER: decodeURIComponent(connection.username),
        PGPASSWORD: decodeURIComponent(connection.password),
        PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
        PGCONNECT_TIMEOUT: "10",
      };
      const dumped = spawnSync("pg_dump", ["--no-password", "--format=custom", "--file", backup],
        { env: backupEnv, stdio: "ignore", timeout: 600_000 });
      if (dumped.status !== 0 || statSync(backup).size === 0) {
        throw new Error("Backup gagal; akun belum dihapus.");
      }
      const checked = spawnSync("pg_restore", ["--list", backup], { stdio: "ignore", timeout: 30_000 });
      if (checked.status !== 0) throw new Error("Backup tidak dapat dibaca; akun belum dihapus.");
      console.log("Backup:", backup);

      const envPath = path.resolve(".env");
      const originalEnv = readFileSync(envPath, "utf8");
      const configured: unknown = JSON.parse(process.env.ORDER_SYNC_INITIAL_DAYS_BY_SHOP || "{}");
      if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
        throw new Error("Pengaturan periode toko tidak valid; akun belum dihapus.");
      }
      if (Object.entries(configured).some(([shop, days]) =>
        !/^\d+$/.test(shop) || typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 90)) {
        throw new Error("Pengaturan periode toko tidak valid; akun belum dihapus.");
      }
      const periods = { ...configured, [target.externalShopId]: 90 };
      const envBackup = path.join(backupDir, `before-reset-maxspeed-${stamp}.env`);
      writeFileSync(envBackup, originalEnv, { mode: 0o600, flag: "wx" });
      const entry = `ORDER_SYNC_INITIAL_DAYS_BY_SHOP='${JSON.stringify(periods)}'`;
      const lines = originalEnv.split(/\r?\n/).filter((line) =>
        !/^\s*(?:export\s+)?ORDER_SYNC_INITIAL_DAYS_BY_SHOP\s*=/.test(line));
      const temporaryEnv = `${envPath}.maxspeed-${process.pid}`;
      writeFileSync(temporaryEnv, `${lines.join("\n").trimEnd()}\n${entry}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporaryEnv, envPath);
      console.log("Periode awal Maxspeed diatur ke 90 hari. Toko lain tidak diubah.");

      console.log("Menghapus data Maxspeed dalam transaksi; tunggu hingga selesai…");
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "PlatformAccount" WHERE id = ${target.id} FOR UPDATE`;
        const current = await tx.platformAccount.findUnique({ where: { id: target.id } });
        if (!current || current.businessId !== target.businessId || current.externalShopId !== target.externalShopId ||
            current.platform !== "TIKTOK_SHOP" || current.label !== "Maxspeed Indonesia") {
          throw new Error("Identitas akun berubah; transaksi dibatalkan.");
        }
        const where = { accountId: target.id };
        await tx.syncLog.deleteMany({ where });
        await tx.salesLog.deleteMany({ where });
        await tx.promotionAuditLog.deleteMany({ where });
        await tx.returnAuditLog.deleteMany({ where });
        await tx.shipment.deleteMany({ where });
        await tx.platformOrderMapping.deleteMany({ where });
        await tx.returnRequest.deleteMany({ where });
        const removed = await tx.order.deleteMany({ where });
        await tx.stockLedger.updateMany({ where, data: { accountId: null } });
        await tx.platformAccount.delete({ where: { id: target.id } });
        console.log("Pesanan dalam transaksi:", removed.count);
      }, { timeout: 600_000, maxWait: 10_000 });
      console.log("Transaksi berhasil. Sisa akun target:", await db.platformAccount.count({ where: { id: target.id } }));
      console.log("Restart maxius-omni sebelum menghubungkan ulang Maxspeed agar pengaturan 90 hari dimuat.");
    }
  }
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  console.error("Operasi belum selesai.", code);
  if (error instanceof Error && error.constructor === Error) console.error(error.message);
  console.error("Periksa status akun sebelum mengulang. Backup dan pengaturan periode yang sudah ditulis tetap disimpan.");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
