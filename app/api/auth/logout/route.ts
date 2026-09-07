import { NextResponse } from "next/server";

export async function POST() {
  // Auth berbasis JWT stateless yang disimpan di localStorage (client-side).
  // Tidak ada server session yang perlu dibersihkan; token hanya dihapus
  // dari client oleh tombol logout di Sidebar.
  return NextResponse.json({ success: true });
}
