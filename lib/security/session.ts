import type { NextRequest } from "next/server";
import { appOrigin } from "@/lib/utils/request-origin";

export function isSameOriginRequest(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  return origin === appOrigin(req);
}

export function allowedRole(role: string, method: string, path: string): boolean {
  if (!["owner", "admin", "staff"].includes(role)) return false;
  if (["GET", "HEAD"].includes(method)) return true;
  const admin = /^\/api\/(?:stores(?:\/|$)|inventory\/settings(?:\/|$)|auth\/(?:shopee|tiktok)\/refresh|marketplace\/tiktok\/promotions\/create|products\/pricing(?:\/|$))/.test(path);
  return !admin || role === "owner" || role === "admin";
}
