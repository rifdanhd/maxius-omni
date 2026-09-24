import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/db/prisma";

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
    { sub: user.id, username: user.username, canViewFullPii: user.canViewFullPii },
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
  return jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
}
