import type { NextRequest } from "next/server";

// Origin publik dari request di balik reverse proxy.
// Next membangun req.url dari hostname internal server (localhost:3000)
// kecuali trustHostHeader — jadi redirect OAuth harus pakai header
// x-forwarded-host/host + x-forwarded-proto agar tetap di domain asli.
export function appOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}
