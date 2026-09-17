import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { prisma } from "@/lib/db/prisma";
import { uploadProductImage } from "@/lib/integrations/tiktokShop";

// POST /api/marketplace/tiktok/images/upload (multipart: "file", ops. "accountId", "useCase")
//   Upload gambar ke Tokopedia | Shop (MainImage dsb). Semua gambar produk TikTok
//   WAJIB lewat API ini, dialihkan di sini sebagai proksi.
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const sp = req.nextUrl.searchParams;
  const accountId = sp.get("accountId") ?? undefined;

  let acc = accountId
    ? await prisma.platformAccount.findUnique({ where: { id: accountId } })
    : null;
  if (acc && acc.businessId !== req.businessId) acc = null;
  if (!acc?.accessToken) {
    acc = await prisma.platformAccount.findFirst({
      where: { platform: "TIKTOK_SHOP", accessToken: { not: null }, businessId: req.businessId },
    });
  }
  if (!acc?.accessToken) {
    return NextResponse.json({ error: "Tidak ada akun Tokopedia | Shop valid." }, { status: 400 });
  }

  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  const useCase = (fd?.get("useCase") as string | undefined) ?? "MAIN_IMAGE";
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Field 'file' wajib diisi." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const { uri, url } = await uploadProductImage(
      acc.accessToken,
      buf,
      useCase,
      file.name || "image"
    );
    return NextResponse.json({ ok: true, uri, url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload gambar gagal.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});