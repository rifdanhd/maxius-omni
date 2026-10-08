import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/db/prisma";
import { tokenMatchesUser } from "@/lib/security/auth-policy";
import { DEFAULT_BUSINESS_ID, getUserBusinessIds } from "@/lib/services/business-scope.service";

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

  const ids = await getUserBusinessIds(user.id);
  const businessId = ids.includes(DEFAULT_BUSINESS_ID) ? DEFAULT_BUSINESS_ID : ids[0];
  if (!businessId) throw new Error("User tidak punya akses brand.");
  const token = createSessionToken(user, businessId);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      canViewFullPii: user.canViewFullPii,
    },
  };
}

export function createSessionToken(user: { id: string; username: string; canViewFullPii: boolean; tokenVersion: number }, businessId: string): string {
  return jwt.sign({ sub: user.id, username: user.username, canViewFullPii: user.canViewFullPii, tokenVersion: user.tokenVersion, businessId }, JWT_SECRET, { expiresIn: "8h", algorithm: "HS256" });
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
    if (!await verifiedTokenUser(payload) || typeof payload.businessId !== "string" || typeof payload.sub !== "string") return null;
    const membership = await prisma.userBusiness.findUnique({ where: { userId_businessId: { userId: payload.sub, businessId: payload.businessId } } });
    return membership ? { ...payload, role: membership.role } : null;
  } catch {
    return null;
  }
}
