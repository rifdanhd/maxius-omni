import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

// GET /api/businesses — brand yg boleh diakses user (fase 1: semua brand).
// Dipakai brand switcher. Tanpa ?businessId= scoping (ini sumber daftarnya).
export const GET = withAuth(async (req) => {
  const memberships = await prisma.userBusiness.findMany({
    where: { userId: req.user.id },
    include: { business: { select: { id: true, name: true } } },
    orderBy: { business: { name: "asc" } },
  });
  return NextResponse.json({
    businesses: memberships.map((m) => ({ id: m.business.id, name: m.business.name })),
  });
});
