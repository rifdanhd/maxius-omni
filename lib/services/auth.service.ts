import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/db/prisma";

const JWT_SECRET = process.env.JWT_SECRET!;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET belum diisi di file .env");
}

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
