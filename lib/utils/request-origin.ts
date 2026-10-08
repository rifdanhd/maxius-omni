import type { NextRequest } from "next/server";

// Origin publik dari request di balik reverse proxy.
// Next membangun req.url dari hostname internal server (localhost:3000)
// kecuali trustHostHeader — jadi redirect OAuth harus pakai header
// x-forwarded-host/host + x-forwarded-proto agar tetap di domain asli.
export function appOrigin(req: NextRequest): string {
  const configured = process.env.APP_ORIGIN;
  if (configured) {
    const url = new URL(configured);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
        (url.protocol !== "https:" && process.env.NODE_ENV === "production")) {
      throw new Error("APP_ORIGIN harus berupa origin HTTPS yang valid.");
    }
    return url.origin;
  }
  if (process.env.NODE_ENV === "production") return "https://maxius.id";
  const url = new URL(req.url);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.origin;
  return "http://localhost:3000";
}
