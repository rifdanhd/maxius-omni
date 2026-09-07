import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

export const GET = withAuth(async () => {
  const accounts = await prisma.platformAccount.findMany({
    select: { id: true, platform: true, label: true },
    orderBy: { platform: "asc" },
  });
  return NextResponse.json({ accounts });
});
