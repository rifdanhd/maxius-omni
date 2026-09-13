import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

export const DELETE = withAuth(async (_req, ctx) => {
  try {
    const { id } = (await ctx?.params) as { id: string };
    
    // Delete the account
    await prisma.platformAccount.delete({
      where: { id }
    });

    return NextResponse.json({ success: true, message: "Store deleted successfully" });
  } catch (error) {
    console.error("Error deleting store:", error);
    return NextResponse.json({ error: "Failed to delete store" }, { status: 500 });
  }
});
