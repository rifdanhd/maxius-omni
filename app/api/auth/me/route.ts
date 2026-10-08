import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
export const GET = withAuth(async req => NextResponse.json({ user: req.user, businessId: req.businessId }));
