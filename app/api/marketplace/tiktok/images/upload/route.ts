import { NextResponse } from "next/server";
import { readValidatedUpload } from "@/lib/security/validate-upload";
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

  const { file, buffer: buf, form } = await readValidatedUpload(req);
  const useCase = String(form.get("useCase") ?? "MAIN_IMAGE");
  if (!["MAIN_IMAGE", "DESCRIPTION_IMAGE", "SKU_IMAGE", "CERTIFICATION_IMAGE"].includes(useCase)) {
    return NextResponse.json({ error: "Use case tidak valid." }, { status: 400 });
  }
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
