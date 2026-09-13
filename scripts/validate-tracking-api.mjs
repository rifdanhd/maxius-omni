/**
 * [OPS] Validasi bentuk response Get Tracking TikTok Shop — READ-ONLY
 * (tidak menulis ke DB, tidak mengubah kode production).
 *
 * (a) Fungsi: memanggil GET /fulfillment/202309/orders/{order_id}/tracking
 *     untuk 1 order non-final (prefer AWAITING_COLLECTION) yang dipilih
 *     otomatis dari DB, lalu mencetak response mentah + analisis struktur
 *     field-nya ke terminal.
 * (b) Kapan dipakai: kalau TikTok mengubah format response tracking (field
 *     baru/hilang, action_code berubah makna, unit waktu berubah) — jalankan
 *     ini DULU untuk melihat bentuk aslinya sebelum menyentuh parser di
 *     lib/services/shipment-tracking.service.ts.
 * (c) Cara jalankan:
 *       node --env-file=.env scripts/validate-tracking-api.mjs
 *     Env yang dibutuhkan (di .env): TIKTOK_APP_KEY, TIKTOK_APP_SECRET,
 *     DATABASE_URL — plus minimal 1 akun TIKTOK_SHOP dengan token valid di DB.
 */
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TIKTOK_API_BASE = "https://open-api.tiktokglobalshop.com";
const APP_KEY = process.env.TIKTOK_APP_KEY;
const APP_SECRET = process.env.TIKTOK_APP_SECRET;

if (!APP_KEY || !APP_SECRET) {
  console.error("TIKTOK_APP_KEY / TIKTOK_APP_SECRET belum diisi di .env");
  process.exit(1);
}

// Mirip generateSign() di lib/integrations/tiktokShop.ts.
function generateSign(apiPath, queryParams) {
  const EXCLUDED_KEYS = ["sign", "access_token"];
  const sortedParamString = Object.keys(queryParams)
    .filter((key) => !EXCLUDED_KEYS.includes(key))
    .sort()
    .map((key) => `${key}${queryParams[key]}`)
    .join("");
  const signString = `${APP_SECRET}${apiPath}${sortedParamString}${APP_SECRET}`;
  return crypto.createHmac("sha256", APP_SECRET).update(signString).digest("hex");
}

async function getTracking(accessToken, shopCipher, orderId) {
  const apiPath = `/fulfillment/202309/orders/${encodeURIComponent(orderId)}/tracking`;
  const queryParams = {
    app_key: APP_KEY,
    timestamp: Math.floor(Date.now() / 1000),
    shop_cipher: shopCipher,
  };
  queryParams.sign = generateSign(apiPath, queryParams);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(queryParams)) qs.set(k, String(v));

  const res = await fetch(`${TIKTOK_API_BASE}${apiPath}?${qs.toString()}`, {
    headers: {
      "Content-Type": "application/json",
      "x-tts-access-token": accessToken,
      "User-Agent": "maxius-platform/1.0.0",
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 2000) };
  }
  return { httpStatus: res.status, json };
}

// Analisis struktur: cetak tipe/keys tiap field di data, plus sampel elemen array.
function analyze(obj, prefix = "", depth = 0) {
  if (obj === null || obj === undefined || depth > 3) return;
  if (Array.isArray(obj)) {
    console.log(`${prefix}: Array(length=${obj.length})`);
    if (obj.length > 0) analyze(obj[0], `${prefix}[0]`, depth + 1);
    return;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        console.log(`${prefix}${k}: Array(length=${v.length})`);
        if (v.length > 0) analyze(v[0], `${prefix}${k}[0]`, depth + 1);
      } else if (v !== null && typeof v === "object") {
        console.log(`${prefix}${k}: Object`);
        analyze(v, `${prefix}${k}.`, depth + 1);
      } else {
        const shown = v === null ? "null" : String(v).slice(0, 80);
        console.log(`${prefix}${k}: ${typeof v} = ${shown}`);
      }
    }
    return;
  }
  console.log(`${prefix}: ${typeof obj} = ${String(obj).slice(0, 80)}`);
}

// --- pilih order uji: non-final, prefer AWAITING_COLLECTION ---
const STATUS_PRIORITY = [
  "AWAITING_COLLECTION",
  "IN_TRANSIT",
  "PARTIALLY_SHIPPING",
  "AWAITING_SHIPMENT",
  "ON_HOLD",
];

let picked = null;
for (const status of STATUS_PRIORITY) {
  const candidates = await prisma.order.findMany({
    where: {
      status,
      account: { platform: "TIKTOK_SHOP" },
      orderMappings: { some: {} },
    },
    include: {
      account: { select: { id: true, label: true, accessToken: true, shopCipher: true } },
      orderMappings: { select: { externalOrderId: true } },
      shipments: { select: { externalId: true, trackingNo: true, carrier: true, status: true } },
    },
    orderBy: { createTime: "desc" },
    take: 1,
  });
  const usable = candidates.filter(
    (c) => c.account.accessToken && c.account.shopCipher && c.orderMappings[0]?.externalOrderId
  );
  if (usable.length > 0) {
    picked = { status, order: usable[0] };
    break;
  }
}

if (!picked) {
  console.error("Tidak ada order non-final TIKTOK_SHOP dengan mapping di DB. Jalankan sync dulu.");
  process.exit(1);
}

const { order } = picked;
const externalOrderId = order.orderMappings[0]?.externalOrderId;
const acc = order.account;

console.log("=== ORDER UJI ===");
console.log(
  JSON.stringify(
    {
      orderNo: order.orderNo,
      status: order.status,
      externalOrderId,
      account: acc.label,
      shipments: order.shipments,
    },
    null,
    2
  )
);

console.log("\n=== RESPONSE MENTAH Get Tracking ===");
const { httpStatus, json } = await getTracking(acc.accessToken, acc.shopCipher, externalOrderId);
console.log(`HTTP ${httpStatus}`);
console.log(JSON.stringify(json, null, 2).slice(0, 6000));

if (json?.code === 0) {
  console.log("\n=== ANALISIS STRUKTUR data ===");
  analyze(json.data, "data.");
} else {
  console.log("\n=== GAGAL: code != 0 (lihat response mentah di atas) ===");
}

await prisma.$disconnect();
