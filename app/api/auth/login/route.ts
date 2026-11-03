import { NextRequest, NextResponse } from "next/server";
import { login, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/services/auth.service";
import { isLoginOriginValid } from "@/lib/security/session";
import { z } from "zod";
import { limiter, rateKey, rateLimitedResponse } from "@/lib/security/rate-limit";
import { readLimitedStream } from "@/lib/security/validate-upload";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REVIEWER_LOG_DIR = join(process.cwd(), "logs");
const REVIEWER_LOG_FILE = join(REVIEWER_LOG_DIR, "reviewer-login.log");

if (!existsSync(REVIEWER_LOG_DIR)) mkdirSync(REVIEWER_LOG_DIR, { recursive: true });

function logReviewerLogin(entry: { username: string; ip: string; userAgent: string | null; result: string; reason?: string }): void {
  if (entry.username.toLowerCase() !== "reviewer") return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
  });
  appendFileSync(REVIEWER_LOG_FILE, line + "\n");
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xrip = req.headers.get("x-real-ip");
  if (xrip) return xrip;
  return "unknown";
}

export async function POST(req: NextRequest) {
  if (!isLoginOriginValid(req)) {
    logReviewerLogin({ username: "", ip: getClientIp(req), userAgent: req.headers.get("user-agent"), result: "blocked", reason: "origin_tidak_valid" });
    return NextResponse.json({ error: "Origin tidak valid." }, { status: 403 });
  }
  if (!limiter.allow("login:global", 60, 60_000)) {
    logReviewerLogin({ username: "", ip: getClientIp(req), userAgent: req.headers.get("user-agent"), result: "blocked", reason: "rate_limit_global" });
    return rateLimitedResponse();
  }
  try {
    const bytes = await readLimitedStream(req.body, 4096);
    const body = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(128) }).parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
    const { username, password } = body;
    if (!limiter.allow(`login:user:${rateKey(username.toLowerCase())}`, 5, 60_000)) {
      logReviewerLogin({ username, ip: getClientIp(req), userAgent: req.headers.get("user-agent"), result: "blocked", reason: "rate_limit_per_user" });
      return rateLimitedResponse();
    }

    if (!username || !password) {
      logReviewerLogin({ username, ip: getClientIp(req), userAgent: req.headers.get("user-agent"), result: "failed", reason: "kredensial_kosong" });
      return NextResponse.json(
        { error: "Username dan password wajib diisi." },
        { status: 400 }
      );
    }

    try {
      const result = await login(username, password);
      logReviewerLogin({ username, ip: getClientIp(req), userAgent: req.headers.get("user-agent"), result: "success" });
      const res = NextResponse.json({ user: result.user });
      res.cookies.set(SESSION_COOKIE, result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE_S,
      });
      return res;
    } catch {
      logReviewerLogin({ username, ip: getClientIp(req), userAgent: req.headers.get("user-agent"), result: "failed", reason: "kredensial_salah" });
      return NextResponse.json({ error: "Username atau password salah." }, { status: 401 });
    }
  } catch {
    logReviewerLogin({ username: "", ip: getClientIp(req), userAgent: req.headers.get("user-agent"), result: "failed", reason: "body_tidak_valid" });
    return NextResponse.json({ error: "Username atau password salah." }, { status: 401 });
  }
}
