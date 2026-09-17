import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";

export const DELETE = withAuth(async (req, ctx) => {
  try {
    const { id } = (await ctx?.params) as { id: string };

    const existing = await prisma.platformAccount.findUnique({
      where: { id },
      select: { id: true, businessId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Store tidak ditemukan." }, { status: 404 });
    }
    try {
      assertSameBrand(existing.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Store tidak ditemukan." }, { status: 404 });
    }

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
