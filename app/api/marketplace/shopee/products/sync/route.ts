import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { syncShopeeListings } from "@/lib/services/marketplace-shopee.service";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const selectionSchema = z.object({
  accountIds: z.array(z.string().min(1).max(128)).min(1).max(100).optional(),
  products: z.array(z.object({
    accountId: z.string().min(1).max(128),
    productId: z.string().regex(/^[1-9]\d*$/).refine((id) => Number.isSafeInteger(Number(id))),
  }).strict()).min(1).max(100).optional(),
}).strict();

export const POST = withAuth(async (req) => {
  const selection = selectionSchema.parse(req.headers.get("content-type")?.includes("application/json") ? await req.json() : {});
  if (selection.accountIds && selection.products) return NextResponse.json({ error: "Pilih toko atau produk, bukan keduanya." }, { status: 400 });
  const accountIds = [...new Set(selection.products?.map((product) => product.accountId) ?? selection.accountIds ?? [])];
  if (accountIds.length) {
    const count = await prisma.platformAccount.count({ where: { id: { in: accountIds }, platform: "SHOPEE", businessId: req.businessId } });
    if (count !== accountIds.length) return NextResponse.json({ error: "Toko tidak ditemukan pada bisnis aktif." }, { status: 404 });
  }
  if (selection.products) {
    const mappings = await prisma.productMapping.findMany({
      where: { account: { platform: "SHOPEE", businessId: req.businessId },
        OR: selection.products.map((product) => ({ accountId: product.accountId, platformProductId: product.productId })) },
      select: { accountId: true, platformProductId: true },
    });
    const found = new Set(mappings.map((mapping) => JSON.stringify([mapping.accountId, mapping.platformProductId])));
    if (selection.products.some((product) => !found.has(JSON.stringify([product.accountId, product.productId])))) {
      return NextResponse.json({ error: "Produk tidak ditemukan pada toko yang dipilih." }, { status: 404 });
    }
  }
  try {
    const results = await syncShopeeListings(req.businessId, undefined, selection);
    return NextResponse.json({ ok: true, accounts: results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync gagal.";
    console.error("[Shopee] sync listing error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});
