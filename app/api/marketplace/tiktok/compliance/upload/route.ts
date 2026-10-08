import { NextResponse } from "next/server";
import { readValidatedUpload } from "@/lib/security/validate-upload";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { prisma } from "@/lib/db/prisma";
import {
  uploadProductImage,
  uploadProductFile,
} from "@/lib/integrations/tiktokShop";

// POST /api/marketplace/tiktok/compliance/upload (multipart: "file", ops. "accountId")
//   Upload dokumen sertifikasi ke Tokopedia | Shop. File gambar → CERTIFICATION_IMAGE;
//   selain itu → files/upload (PDF dll).
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

  const { file, buffer: buf, mime } = await readValidatedUpload(req, true);
  const fileName = file.name || "certificate";
  const isImage = mime.startsWith("image/");
  try {
    if (isImage) {
      const { uri } = await uploadProductImage(acc.accessToken, buf, "CERTIFICATION_IMAGE", fileName);
      return NextResponse.json({ ok: true, kind: "image", uri });
    }
    const up = await uploadProductFile(acc.accessToken, buf, fileName);
    return NextResponse.json({
      ok: true,
      kind: "file",
      id: up.id,
      name: up.name,
      format: up.format,
      url: up.url,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload dokumen gagal.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});
