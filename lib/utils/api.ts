import { NextRequest } from "next/server";
import { verifyToken, verifiedTokenUser, SESSION_COOKIE } from "@/lib/services/auth.service";
import { prisma } from "@/lib/db/prisma";
import { allowedRole, isSameOriginRequest } from "@/lib/security/session";
import { mayViewPii } from "@/lib/security/auth-policy";
import { UploadValidationError, readLimitedStream } from "@/lib/security/validate-upload";
import { limiter, rateLimitedResponse } from "@/lib/security/rate-limit";
import { InputError, validateApiJson } from "@/lib/security/input";
import { ZodError } from "zod";
import {
  BusinessScopeError,
  resolveRequestBusiness,
} from "@/lib/services/business-scope.service";

export interface AuthenticatedRequest extends NextRequest {
  user: { id: string; username: string; canViewFullPii: boolean; role: string };
  // Brand aktif yg sudah tervalidasi keanggotaannya (fase multi-brand).
  // Route yg menampilkan data brand WAJIB filter dgn ini.
  businessId: string;
}

/**
 * withAuth(handler)
 *
 * Higher-order function untuk memproteksi API route.
 * Cara pakai:
 *
 *   export const GET = withAuth(async (req) => {
 *     const user = req.user; // sudah terisi
 *     return NextResponse.json({ ... });
 *   });
 */
export function withAuth(
  handler: (
    req: AuthenticatedRequest,
    ctx?: { params: Promise<Record<string, string | undefined>> }
  ) => Promise<Response>
) {
  return async (
    req: NextRequest,
    ctx: { params: Promise<Record<string, string | undefined>> }
  ): Promise<Response> => {
    const authHeader = req.headers.get("authorization");
    const cookieToken = req.cookies.get(SESSION_COOKIE)?.value;
    const token = cookieToken ?? (authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null);

    if (cookieToken && !["GET", "HEAD"].includes(req.method) && !isSameOriginRequest(req)) {
      return Response.json({ error: "Origin tidak valid." }, { status: 403 });
    }

    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!limiter.allow("api:global", 3000, 60_000)) return rateLimitedResponse();

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return Response.json(
        { error: "Token tidak valid atau sudah kadaluarsa." },
        { status: 401 }
      );
    }

    let dbUser;
    try { dbUser = await verifiedTokenUser(payload); }
    catch (error) { console.error("[withAuth] session lookup failed", error); return Response.json({ error: "Terjadi kesalahan server." }, { status: 503 }); }
    if (!dbUser) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const user = {
      id: dbUser.id,
      username: dbUser.username,
      canViewFullPii: mayViewPii({ canViewFullPii: payload.canViewFullPii }, dbUser),
      role: "staff",
    };
    (req as AuthenticatedRequest).user = user;

    try {
      if (typeof payload.businessId !== "string") return Response.json({ error: "Sesi perlu diperbarui." }, { status: 401 });
      (req as AuthenticatedRequest).businessId = await resolveRequestBusiness(req, user.id, payload.businessId);
      const member = await prisma.userBusiness.findUnique({ where: { userId_businessId: { userId: user.id, businessId: payload.businessId } } });
      if (!member || !allowedRole(member.role, req.method, req.nextUrl.pathname)) return Response.json({ error: "Akses ditolak." }, { status: 403 });
      user.role = member.role;
      const sensitive = /(?:upload|product-copy|label|promotions\/create)/.test(req.nextUrl.pathname);
      if (!limiter.allow(`${user.id}:${sensitive ? req.nextUrl.pathname : req.method}`, sensitive ? 15 : (req.method === "GET" ? 600 : 120), 60_000)) return rateLimitedResponse();
    } catch (e) {
      if (e instanceof BusinessScopeError) {
        return Response.json({ error: e.message }, { status: 403 });
      }
      console.error("[withAuth] resolveRequestBusiness error:", e);
      return Response.json({ error: "Terjadi kesalahan server." }, { status: 500 });
    }

    try {
      if (!["GET", "HEAD"].includes(req.method) && req.body &&
          !req.headers.get("content-type")?.includes("application/json") &&
          !req.headers.get("content-type")?.startsWith("multipart/form-data;")) {
        return Response.json({ error: "Content-Type tidak didukung." }, { status: 415 });
      }
      if (!["GET", "HEAD"].includes(req.method) && req.headers.get("content-type")?.includes("application/json")) {
        if (Number(req.headers.get("content-length")) > 1024 * 1024) return Response.json({ error: "Body terlalu besar." }, { status: 413 });
        const bytes = await readLimitedStream(req.body, 1024 * 1024);
        let value: unknown;
        try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new InputError("JSON tidak valid."); }
        validateApiJson(value);
        req.json = async () => value;
      }
      const response = await handler(req as AuthenticatedRequest, ctx);
      response.headers.set("Cache-Control", "private, no-store");
      if (response.status >= 500 && response.headers.get("content-type")?.includes("application/json")) {
        return Response.json({ error: "Operasi gagal. Coba lagi atau periksa log server." }, { status: response.status, headers: { "Cache-Control": "private, no-store" } });
      }
      return response;
    } catch (e) {
      if (e instanceof InputError || e instanceof ZodError) return Response.json({ error: e instanceof InputError ? e.message : "Input tidak valid." }, { status: 400 });
      if (e instanceof UploadValidationError) return Response.json({ error: e.message }, { status: e.status });
      console.error("[withAuth] handler error:", e);
      return Response.json({ error: "Terjadi kesalahan server." }, { status: 500 });
    }
  };
}
