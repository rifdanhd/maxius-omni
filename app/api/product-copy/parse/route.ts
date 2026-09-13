import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import {
  parseProductFromUrl,
  CopyError,
  type CopyParseResult,
} from "@/lib/services/product-copy.service";

// POST /api/product-copy/parse
// Body: { url: string } → ambil HTML halaman produk publik & parse (tanpa simpan).
export const POST = withAuth(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ ok: false, error: "Field url wajib diisi." }, { status: 400 });
  }

  try {
    const result: CopyParseResult = await parseProductFromUrl(url);
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    if (e instanceof CopyError) {
      const status = e.code === "INVALID_URL" ? 400 : e.code === "FETCH_FAILED" ? 502 : 422;
      return NextResponse.json({ ok: false, code: e.code, error: e.message }, { status });
    }
    const msg = e instanceof Error ? e.message : "Terjadi kesalahan saat mengambil data.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});