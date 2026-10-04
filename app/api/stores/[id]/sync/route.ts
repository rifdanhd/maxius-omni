import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { syncShopeeListings } from "@/lib/services/marketplace-shopee.service";
import { syncTikTokListings } from "@/lib/services/marketplace-tiktok.service";

export const POST = withAuth(async (req, ctx) => {
  try {
    const { id } = (await ctx?.params) as { id: string };

    const account = await prisma.platformAccount.findUnique({ where: { id } });
    if (!account) {
      return NextResponse.json({ error: "Toko tidak ditemukan" }, { status: 404 });
    }
    try {
      assertSameBrand(account.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Toko tidak ditemukan" }, { status: 404 });
    }

    if (account.isFrozen) return NextResponse.json({ error: "Toko dibekukan. Hubungi admin sebelum memperbarui data." }, { status: 409 });
    if (account.platform !== "SHOPEE" && account.platform !== "TIKTOK_SHOP") return NextResponse.json({ error: "Pembaruan produk untuk marketplace ini belum tersedia." }, { status: 400 });
    const results = account.platform === "SHOPEE"
      ? await syncShopeeListings(req.businessId, account.id)
      : await syncTikTokListings(req.businessId, account.id);
    const result = results[0];
    if (!result || result.error) return NextResponse.json({ error: result?.error ?? "Toko tidak tersedia untuk diperbarui." }, { status: 502 });
    return NextResponse.json({ success: true, message: "Data produk toko selesai diperbarui. Produk baru tetap perlu diimpor atau dihubungkan ke katalog pusat.", result });
  } catch (error) {
    console.error("Error syncing store:", error);
    return NextResponse.json({ error: "Gagal memperbarui data toko. Coba lagi atau periksa koneksi toko." }, { status: 500 });
  }
});
