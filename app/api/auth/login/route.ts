import { NextRequest, NextResponse } from "next/server";
import { login } from "@/lib/services/auth.service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username dan password wajib diisi." },
        { status: 400 }
      );
    }

    const result = await login(username, password);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Login gagal.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
