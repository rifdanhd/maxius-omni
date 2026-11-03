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

function logReviewerLogin(entry: {
  username: string;
  ip: string;
  userAgent: string | null;
  result: string;
  reason?: string;
}): void {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    });
    appendFileSync(REVIEWER_LOG_FILE, line + "\n");
  } catch {
    // Kegagalan logging TIDAK BOLEH memengaruhi respons login.
  }
}

function getClientIp(req: NextRequest): string {
  const xrip = req.headers.get("x-real-ip");
  if (xrip) return xrip;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

const WRONG_CREDENTIALS_MSG = "Username atau password salah.";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent");

  // ── Blokir sebelum body dibaca: catat walau username belum diketahui ──
  if (!isLoginOriginValid(req)) {
    logReviewerLogin({ username: "", ip, userAgent, result: "blocked", reason: "origin_tidak_valid" });
    return NextResponse.json({ error: "Origin tidak valid." }, { status: 403 });
  }
  if (!limiter.allow("login:global", 60, 60_000)) {
    logReviewerLogin({ username: "", ip, userAgent, result: "blocked", reason: "rate_limit_global" });
    return rateLimitedResponse();
  }

  try {
    const bytes = await readLimitedStream(req.body, 4096);
    const body = z.object({
      username: z.string().trim().min(1).max(100),
      password: z.string().min(1).max(128),
    }).parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
    const { username, password } = body;

    const isReviewer = username.toLowerCase() === "reviewer";

    if (!limiter.allow(`login:user:${rateKey(username.toLowerCase())}`, 5, 60_000)) {
      if (isReviewer) {
        logReviewerLogin({ username, ip, userAgent, result: "blocked", reason: "rate_limit_per_user" });
      }
      return rateLimitedResponse();
    }

    if (!username || !password) {
      if (isReviewer) {
        logReviewerLogin({ username, ip, userAgent, result: "failed", reason: "kredensial_kosong" });
      }
      return NextResponse.json(
        { error: "Username dan password wajib diisi." },
        { status: 400 }
      );
    }

    try {
      const result = await login(username, password);
      if (isReviewer) {
        logReviewerLogin({ username, ip, userAgent, result: "success" });
      }
      const res = NextResponse.json({ user: result.user });
      res.cookies.set(SESSION_COOKIE, result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE_S,
      });
      return res;
    } catch (err) {
      console.error("[Login] failed", err instanceof Error ? err.name : "unknown");
      const isWrongCredentials = err instanceof Error && err.message === WRONG_CREDENTIALS_MSG;
      if (isWrongCredentials) {
        if (isReviewer) {
          logReviewerLogin({ username, ip, userAgent, result: "failed", reason: "kredensial_salah" });
        }
        return NextResponse.json({ error: WRONG_CREDENTIALS_MSG }, { status: 401 });
      }
      // Error internal (DB, JWT, dsb.) — jangan tampilkan sebagai kredensial salah.
      if (isReviewer) {
        logReviewerLogin({ username, ip, userAgent, result: "failed", reason: "error_internal" });
      }
      return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
    }
  } catch {
    // Body tidak bisa dibaca/diparsing — catat walau username belum diketahui.
    logReviewerLogin({ username: "", ip, userAgent, result: "failed", reason: "body_tidak_valid" });
    return NextResponse.json({ error: "Username atau password salah." }, { status: 401 });
  }
}
