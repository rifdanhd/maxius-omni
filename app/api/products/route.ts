import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

export const GET = withAuth(async () => {
  const products = await prisma.masterProduct.findMany({
    include: {
      variants: {
        include: {
          mappings: {
            include: {
              account: { select: { id: true, platform: true, label: true } },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ products });
});
