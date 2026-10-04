import { NextResponse } from "next/server";

export function proxy() {
  if (process.env.NEXT_PUBLIC_ENABLE_OFFICE === "true" && process.env.NODE_ENV === "development") {
    return NextResponse.next();
  }
  return new NextResponse("Not Found", { status: 404 });
}

export const config = {
  matcher: ["/office/:path*", "/api/agents/:path*", "/api/agent-office/:path*"],
};
