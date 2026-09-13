import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { maskName } from "@/lib/pii";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const PLAIN_STATUSES = [
  "UNPAID",
  "ON_HOLD",
  "AWAITING_SHIPMENT",
  "PARTIALLY_SHIPPING",
  "AWAITING_COLLECTION",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
] as const;

export const GET = withAuth(async (req) => {
  const { searchParams } = new URL(req.url);
  const statusRaw = searchParams.get("status");
  const hasStatusFilter = statusRaw !== null;
  const statusParam = statusRaw?.trim();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSizeRaw = Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSizeRaw));
  const sortRaw = searchParams.get("sort")?.trim();
  const sortField = sortRaw === "amount" || sortRaw === "createTime" ? sortRaw : "createTime";
  const sortDirRaw = searchParams.get("dir")?.trim();
  const sortDir = sortDirRaw === "asc" ? "asc" : "desc";

  const statuses = hasStatusFilter
    ? (statusParam ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  // statuses = null → tanpa filter (tab "Semua Pesanan").
  // statuses = [] → tab tanpa status order yang sah (mis. Pengembalian) → jangan return apa pun.
  const whereStatus =
    statuses === null
      ? {}
      : statuses.length === 0
        ? { status: "__NONE__" }
        : { status: { in: statuses } };

  // Search berdasarkan tipe field yang dipilih di dropdown frontend:
  //   keyword  → Keyword Pesanan (pencarian luas: orderNo, buyerName, buyerEmail, nama produk)
  //   orderNo  → No. Pesanan (orderNo)
  //   product  → Produk Master (matching nama produk pada item order)
  //   tracking → Nomor Resi (matching nomor resi pada shipment)
  //   (tanpa searchType) → default keyword
  const q = searchParams.get("q")?.trim() || null;
  const searchType = searchParams.get("searchType")?.trim() || "keyword";

  let whereSearch: object = {};
  if (q) {
    if (searchType === "orderNo") {
      // Cari hanya berdasarkan No. Pesanan
      whereSearch = { orderNo: { contains: q } };
    } else if (searchType === "product") {
      // Cari di nama produk / variasi pada item order
      whereSearch = {
        OR: [
          { items: { some: { productName: { contains: q } } } },
          { items: { some: { skuName: { contains: q } } } },
          { items: { some: { channelSku: { contains: q } } } },
        ],
      };
    } else if (searchType === "tracking") {
      // Cari di nomor resi shipment
      whereSearch = {
        OR: [{ shipments: { some: { trackingNo: { contains: q } } } }],
      };
    } else {
      // searchType === "keyword" (default) — pencarian luas di semua field relevan
      whereSearch = {
        OR: [
          { orderNo: { contains: q } },
          { buyerName: { contains: q } },
          { buyerEmail: { contains: q } },
          { items: { some: { productName: { contains: q } } } },
          { items: { some: { skuName: { contains: q } } } },
          { items: { some: { channelSku: { contains: q } } } },
          { shipments: { some: { trackingNo: { contains: q } } } },
        ],
      };
    }
  }

  // Date range: rentang createTime (inclusive start, exclusive end).
  let whereDate = {};
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const gte = from && !isNaN(Date.parse(from)) ? new Date(from) : null;
  const lt = to && !isNaN(Date.parse(to)) ? new Date(new Date(to).getTime() + 86400000) : null;
  if (gte || lt) {
    whereDate = {
      createTime: {
        ...(gte ? { gte } : {}),
        ...(lt ? { lt } : {}),
      },
    };
  }

  const where = { AND: [whereStatus, whereSearch, whereDate] };

  const [orders, total, statusGroups] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        items: {
          include: {
            variant: { include: { masterProduct: { select: { name: true } } } },
          },
        },
        account: { select: { id: true, platform: true, label: true } },
        orderMappings: { select: { externalOrderId: true, rawStatus: true } },
        shipments: { select: { externalId: true, carrier: true, trackingNo: true, status: true } },
      },
      orderBy: { [sortField]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
    prisma.order.groupBy({ by: ["status"], _count: true }),
  ]);

  const counts: Record<string, number> = {};
  statusGroups.forEach((g) => {
    counts[g.status] = g._count;
  });

  // List berarti selalu masked (keputusan PII): nama pembeli, tanpa ciphertext.
  // Reveal penuh hanya terjadi pada GET /api/orders/:id untuk user berhak.
  const maskedOrders = orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    status: o.status,
    buyerName: maskName(o.buyerName),
    buyerEmail: o.buyerEmail,
    amount: o.amount,
    currency: o.currency,
    createTime: o.createTime,
    paidTime: o.paidTime,
    shippingDueTime: o.shippingDueTime,
    rtsSlaTime: o.rtsSlaTime,
    ttsSlaTime: o.ttsSlaTime,
    isCod: o.isCod,
    items: o.items,
    account: o.account,
    orderMappings: o.orderMappings,
    shipments: o.shipments,
  }));

  return NextResponse.json({
    orders: maskedOrders,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    counts,
    // Metadata untuk kolom pencarian (server-side) — tetap kirim daftar status kanonik
    // supaya klien bisa fallback kalau butuh referensi.
    statuses: PLAIN_STATUSES,
  });
});