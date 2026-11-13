import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/utils/api";
import { InventoryConflict } from "@/lib/services/master-stock-mutation.service";
import { connectStoreListings, storeMappingSchema } from "@/lib/services/store-mapping.service";

export const POST = withAuth(async (req) => {
  const input = storeMappingSchema.parse(await req.json());
  try {
    return NextResponse.json({ ok: true, ...await connectStoreListings(req.businessId, req.user.id, input) });
  } catch (error) {
    if (error instanceof InventoryConflict) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Ada pembaruan bersamaan. Muat ulang dan periksa pilihan sebelum mencoba lagi." }, { status: 409 });
    }
    throw error;
  }
});
