export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NEXT_PUBLIC_ENABLE_OFFICE === "true" && process.env.NODE_ENV === "development") {
    const { readSnapshot } = await import("@/lib/agent-office/store");
    try {
      return Response.json(await readSnapshot(), { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "Status agen gagal dibaca. Periksa format file di direktori status agen." }, { status: 500 });
    }
  }
  return new Response("Not Found", { status: 404 });
}
