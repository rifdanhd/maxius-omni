import { NextRequest, NextResponse } from "next/server";
import { recordSale } from "@/lib/services/sales.service";

// Dynamic route: POST /api/webhooks/shopee-1, /api/webhooks/tiktok-2, dll.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await params;
    const body = await req.json();
    const { channelSku, qty } = body;

    const result = await recordSale({ accountId, channelSku, qty });
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
