import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { prisma } from "@/lib/db/prisma";
import {
  uploadProductImage,
  uploadProductFile,
} from "@/lib/integrations/tiktokShop";

// POST /api/marketplace/tiktok/compliance/upload (multipart: "file", ops. "accountId")
//   Upload dokumen sertifikasi ke Tokopedia | Shop. File gambar → CERTIFICATION_IMAGE;
//   selain itu → files/upload (PDF dll).
export const POST = withAuth(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const accountId = sp.get("accountId") ?? undefined;

  let acc = accountId
    ? await prisma.platformAccount.findUnique({ where: { id: accountId } })
    : null;
  if (!acc?.accessToken) {
    acc = await prisma.platformAccount.findFirst({
      where: { platform: "TIKTOK_SHOP", accessToken: { not: null } },
    });
  }
  if (!acc?.accessToken) {
    return NextResponse.json({ error: "Tidak ada akun Tokopedia | Shop valid." }, { status: 400 });
  }

  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Field 'file' wajib diisi." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const fileName = file.name || "certificate";
  const isImage = file.type.startsWith("image/");
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