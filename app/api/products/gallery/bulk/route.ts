import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/utils/api";
import { prisma } from "@/lib/db/prisma";
import { addImages } from "@/lib/services/gallery.service";

const schema = z.object({ rows: z.array(z.object({ sku: z.string().trim().min(1).max(200), url: z.string().url().max(2000).refine((url) => /^https?:\/\//i.test(url)) })).min(1).max(100) });

export const POST = withAuth(async (req) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Isi 1–100 baris SKU pusat dan URL gambar http/https yang valid." }, { status: 400 });
  const results: Array<{ row: number; sku: string; ok: boolean; message: string }> = [];
  for (const [index, row] of parsed.data.rows.entries()) {
    const variants = await prisma.productVariant.findMany({ where: { sku: row.sku, isArchived: false, masterProduct: { businessId: req.businessId } }, select: { masterProductId: true }, take: 2 });
    if (variants.length !== 1) { results.push({ row: index + 1, sku: row.sku, ok: false, message: "SKU tidak ditemukan atau ambigu. Gunakan unggah per produk." }); continue; }
    try {
      const result = await addImages(variants[0].masterProductId, [{ url: row.url }], req.businessId);
      results.push({ row: index + 1, sku: row.sku, ok: result.ok, message: result.ok ? (result.added ? "Gambar ditambahkan" : "Gambar sudah ada") : result.reasons[0]?.reason ?? "Gagal menambah gambar" });
    } catch { results.push({ row: index + 1, sku: row.sku, ok: false, message: "Gambar belum tersimpan. Coba lagi." }); }
  }
  return NextResponse.json({ results, added: results.filter((row) => row.ok).length, failed: results.filter((row) => !row.ok).length });
});
