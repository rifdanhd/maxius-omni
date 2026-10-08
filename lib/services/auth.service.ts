import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/db/prisma";
import { tokenMatchesUser } from "@/lib/security/auth-policy";

const rawJwtSecret = process.env.JWT_SECRET;

if (!rawJwtSecret || rawJwtSecret === "change-this-to-a-long-random-string" || rawJwtSecret.length < 32) {
  throw new Error(
    "JWT_SECRET belum di-set dengan benar. Generate: openssl rand -base64 32 (minimal 32 char, jangan placeholder)."
  );
}

const JWT_SECRET: string = rawJwtSecret;

export interface AuthUser {
  id: string;
  username: string;
  canViewFullPii: boolean;
}

/**
 * login(username, password)
 * Verifikasi kredensial user dan kembalikan signed JWT.
 * Throws Error jika username/password salah.
 */
export async function login(
  username: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    throw new Error("Username atau password salah.");
  }

  const token = jwt.sign(
    { sub: user.id, username: user.username, canViewFullPii: user.canViewFullPii, tokenVersion: user.tokenVersion },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      canViewFullPii: user.canViewFullPii,
    },
  };
}

/**
 * verifyToken(token)
 * Validasi JWT dan kembalikan payload.
 * Throws Error jika token tidak valid atau kadaluarsa.
 */
export function verifyToken(token: string): jwt.JwtPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
}

export async function verifiedTokenUser(payload: jwt.JwtPayload) {
  const user = typeof payload.sub === "string" ? await prisma.user.findUnique({ where: { id: payload.sub } }) : null;
  return tokenMatchesUser(payload, user) ? user : null;
}

/**
 * Cookie sesi httpOnly (JWT yg sama dgn token Bearer). Dipakai utk proteksi
 * endpoint OAuth (authorize/callback) yg dijangkau navigasi browser sehingga
 * tidak bisa membawa header Authorization.
 */
export const SESSION_COOKIE = "maxius_session";
export const SESSION_MAX_AGE_S = 8 * 60 * 60; // = expiresIn JWT

/**
 * verifySessionCookie(req)
 * Baca & verifikasi cookie sesi → payload JWT, atau null bila tidak ada/tidak
 * valid. Tidak melempar — pemanggil memutus sendiri alur error-nya.
 */
export async function verifySessionCookie(req: {
  cookies: { get(name: string): { value?: string } | undefined };
}): Promise<jwt.JwtPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    return await verifiedTokenUser(payload) ? payload : null;
  } catch {
    return null;
  }
}
