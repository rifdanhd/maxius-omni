import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { refreshOrderForShipping } from "@/lib/services/order-refresh.service";

export const POST = withAuth(
  async (req: AuthenticatedRequest, ctx?: { params: Promise<{ id?: string }> }) => {
    const { id } = (await ctx?.params) ?? {};
    if (!id) return NextResponse.json({ error: "ID pesanan wajib diisi." }, { status: 400 });

    try {
      return NextResponse.json({ ok: true, ...(await refreshOrderForShipping(id, req.businessId)) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        { ok: false, error: message },
        { status: message === "Pesanan tidak ditemukan." ? 404 : 502 }
      );
    }
  }
);
