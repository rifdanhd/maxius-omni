import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  try {
    const accounts = await prisma.platformAccount.findMany();
    
    // Map Account to the store format expected by the frontend
    const stores = accounts.map(acc => ({
      id: acc.id,
      name: acc.label,
      url: `https://${acc.platform}.com/${acc.label}`, // mock URL for now
      platform: acc.platform,
      status: acc.accessToken ? 'connected' : 'disconnected',
      connectedAt: '07-09-2026 07:40' // Mock connection time as it's not in DB yet
    }));

    return NextResponse.json(stores);
  } catch (error) {
    console.error("Error fetching stores:", error);
    return NextResponse.json({ error: "Failed to fetch stores" }, { status: 500 });
  }
}
