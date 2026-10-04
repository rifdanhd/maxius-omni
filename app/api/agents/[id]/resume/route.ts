export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (process.env.NEXT_PUBLIC_ENABLE_OFFICE === "true" && process.env.NODE_ENV === "development") {
    const { requestResume, validId } = await import("@/lib/agent-office/store");
    if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Origin permintaan tidak diizinkan." }, { status: 403 });
    const { id } = await context.params;
    if (!validId(id)) return Response.json({ error: "ID tidak valid." }, { status: 400 });
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: "JSON tidak valid." }, { status: 400 }); }
    if (typeof body?.updatedAt !== "string") return Response.json({ error: "Versi status diperlukan." }, { status: 400 });
    try {
      if (!await requestResume(id, body.updatedAt)) return Response.json({ error: "Status berubah atau agen tidak menerima perintah lanjut. Muat ulang status." }, { status: 409 });
      return Response.json({ message: "Perintah lanjut terkirim. Menunggu konfirmasi agen." }, { status: 202 });
    } catch (error) {
      return Response.json({ error: "Perintah tidak dapat dikirim." }, { status: (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500 });
    }
  }
  return new Response("Not Found", { status: 404 });
}
