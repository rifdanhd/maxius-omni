import { NextRequest } from "next/server";
import { verifyToken } from "@/lib/services/auth.service";

export interface AuthenticatedRequest extends NextRequest {
  user: { id: string; username: string };
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
  handler: (req: AuthenticatedRequest) => Promise<Response>
) {
  return async (req: NextRequest): Promise<Response> => {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const payload = verifyToken(token);
      // Inject user ke request object
      (req as AuthenticatedRequest).user = {
        id: payload.sub as string,
        username: payload.username as string,
      };
      return handler(req as AuthenticatedRequest);
    } catch {
      return Response.json(
        { error: "Token tidak valid atau sudah kadaluarsa." },
        { status: 401 }
      );
    }
  };
}
