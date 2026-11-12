import { readFile, writeFile } from "node:fs/promises";
import { prisma } from "../lib/db/prisma";
import { getItemBaseInfo, itemBaseImage } from "../lib/integrations/shopee";
import { loadShopeeAccount, withRefreshedToken } from "../lib/services/marketplace-shopee.service";

type Row = { channelSku: string; productId: string; imageUrl: string };
type Plan = { version: 1; accountId: string; rows: Row[]; skipped: string[] };
const [mode, accountId, file] = process.argv.slice(2);
if (!accountId || !file || !["preview", "apply"].includes(mode)) {
  throw new Error("Usage: tsx scripts/backfill-shopee-images.mts preview|apply ACCOUNT_ID PLAN.json");
}
try {
  const account = await loadShopeeAccount(accountId);
  if (!account || account.platform !== "SHOPEE") throw new Error("Akun Shopee tidak ditemukan");
  const mappings = await prisma.productMapping.findMany({ where: { accountId }, select: { channelSku: true, imageUrl: true } });
  const items = await prisma.orderItem.findMany({ where: { order: { accountId } }, select: { channelSku: true }, distinct: ["channelSku"] });
  const known = new Set([...mappings, ...items].map((r) => r.channelSku));
  if (mode === "preview") {
    const filled = new Set(mappings.filter((m) => m.imageUrl?.trim()).map((m) => m.channelSku));
    const groups = new Map<string, string[]>();
    const skipped: string[] = [];
    for (const sku of known) {
      if (filled.has(sku)) continue;
      const match = /^(\d+):\d+$/.exec(sku);
      if (!match || !Number.isSafeInteger(Number(match[1]))) { skipped.push(`${sku}: invalid identity`); continue; }
      groups.set(match[1], [...(groups.get(match[1]) ?? []), sku]);
    }
    const rows: Row[] = [];
    const ids = [...groups.keys()];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      try {
        const infos = await withRefreshedToken(account, (token, shop, creds) => getItemBaseInfo(token, shop, batch.map(Number), creds));
        const images = new Map(infos.map((info) => [String(info.item_id), itemBaseImage(info)]));
        for (const id of batch) {
          const imageUrl = images.get(id);
          if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) { skipped.push(`${id}: no image`); continue; }
          for (const channelSku of groups.get(id) ?? []) rows.push({ channelSku, productId: id, imageUrl });
        }
      } catch { skipped.push(...batch.map((id) => `${id}: API fetch failed`)); }
    }
    const plan: Plan = { version: 1, accountId, rows, skipped };
    await writeFile(file, JSON.stringify(plan, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ mode, accountId, candidates: rows.length, skipped: skipped.length, file }));
  } else {
    const plan = JSON.parse(await readFile(file, "utf8")) as Plan;
    if (plan.version !== 1 || plan.accountId !== accountId || !Array.isArray(plan.rows)) throw new Error("Plan berbeda akun atau tidak valid");
    for (const row of plan.rows) {
      if (!known.has(row.channelSku) || !/^\d+:\d+$/.test(row.channelSku) || row.channelSku.split(":")[0] !== row.productId || !/^https?:\/\//i.test(row.imageUrl)) throw new Error("Identitas plan tidak valid");
    }
    const result = await prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${`shopee-images:${accountId}`})) AS locked`;
      if (!lock[0]?.locked) throw new Error("Backfill akun ini sedang berjalan");
      let created = 0;
      let updated = 0;
      for (const row of plan.rows) {
        const inserted = await tx.productMapping.createMany({ data: [{ accountId, channelSku: row.channelSku, platformProductId: row.productId, imageUrl: row.imageUrl, updatedAt: new Date() }], skipDuplicates: true });
        created += inserted.count;
        if (!inserted.count) {
          const changed = await tx.productMapping.updateMany({ where: { accountId, channelSku: row.channelSku, OR: [{ imageUrl: null }, { imageUrl: "" }] }, data: { imageUrl: row.imageUrl } });
          updated += changed.count;
        }
      }
      return { created, updated, unchanged: plan.rows.length - created - updated };
    }, { timeout: 120000 });
    console.log(JSON.stringify({ mode, accountId, ...result }));
  }
} finally { await prisma.$disconnect(); }
