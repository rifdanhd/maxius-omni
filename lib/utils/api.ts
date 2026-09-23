import { NextRequest } from "next/server";
import { verifyToken } from "@/lib/services/auth.service";
import {
  BusinessScopeError,
  resolveRequestBusiness,
} from "@/lib/services/business-scope.service";

export interface AuthenticatedRequest extends NextRequest {
  user: { id: string; username: string; canViewFullPii: boolean };
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
    ctx?: { params: Promise<Record<string, string | undefined>> }
  ): Promise<Response> => {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return Response.json(
        { error: "Token tidak valid atau sudah kadaluarsa." },
        { status: 401 }
      );
    }

    // Inject user ke request object. Legacy token (sebelum fitur PII) tidak punya
    // canViewFullPii → default true (perilaku lama = akses penuh, user admin).
    const user = {
      id: payload.sub as string,
      username: payload.username as string,
      canViewFullPii: payload.canViewFullPii !== false,
    };
    (req as AuthenticatedRequest).user = user;

    try {
      (req as AuthenticatedRequest).businessId = await resolveRequestBusiness(req, user.id);
    } catch (e) {
      if (e instanceof BusinessScopeError) {
        return Response.json({ error: e.message }, { status: 403 });
      }
      console.error("[withAuth] resolveRequestBusiness error:", e);
      return Response.json({ error: "Terjadi kesalahan server." }, { status: 500 });
    }

    try {
      return await handler(req as AuthenticatedRequest, ctx);
    } catch (e) {
      console.error("[withAuth] handler error:", e);
      return Response.json({ error: "Terjadi kesalahan server." }, { status: 500 });
    }
  };
}
