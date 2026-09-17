import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

// Platform yang punya halaman/link di menu "Produk Marketplace".
// Label mengikuti nama platform masing-masing (bukan nama hasil merger).
const PLATFORM_MENU: Record<string, { key: string; label: string; href: string }> = {
  SHOPEE: { key: "shopee", label: "Shopee", href: "/products/marketplace/shopee" },
  TIKTOK_SHOP: { key: "tiktok-shop", label: "TikTok Shop", href: "/products/marketplace/tiktok" },
  TOKOPEDIA: { key: "tokopedia", label: "Tokopedia | Shop", href: "/products/marketplace/tokopedia" },
};

const PLATFORM_ORDER = ["SHOPEE", "TIKTOK_SHOP", "TOKOPEDIA"] as const;

export const GET = withAuth(async (req) => {
  const accounts = await prisma.platformAccount.findMany({
    where: { businessId: req.businessId },
    select: { platform: true, accessToken: true },
  });

  // Akun dianggap "terhubung/aktif" bila punya accessToken (skema tanpa field status).
  const platforms = PLATFORM_ORDER.filter(
    (platform) =>
      platform in PLATFORM_MENU &&
      accounts.some(
        (a) =>
          a.platform === platform &&
          typeof a.accessToken === "string" &&
          a.accessToken.trim().length > 0
      )
  ).map((platform) => PLATFORM_MENU[platform]);

  return NextResponse.json({ ok: true, platforms });
});