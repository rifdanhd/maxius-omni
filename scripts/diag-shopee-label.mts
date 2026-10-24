import { prisma } from "../lib/db/prisma";
import { loadShopeeAccount, withRefreshedToken } from "../lib/services/marketplace-shopee.service";
import {
  createShippingDocument,
  downloadShippingDocument,
  getShippingDocumentParameter,
  getShippingDocumentResult,
} from "../lib/integrations/shopee";

async function main() {
  console.log("=== Diagnosa Cetak Resi Shopee ===\n");

  const orders = await prisma.order.findMany({
    where: { account: { platform: "SHOPEE" }, status: { in: ["AWAITING_SHIPMENT", "AWAITING_COLLECTION"] } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      orderNo: true,
      status: true,
      accountId: true,
      shipments: { select: { externalId: true, trackingNo: true, status: true } },
    },
  });

  if (orders.length === 0) {
    console.log("Tidak ada order Shopee AWAITING_SHIPMENT/AWAITING_COLLECTION.");
    return;
  }

  for (const o of orders) {
    console.log("--------------------------------------------------");
    console.log(`Order No    : ${o.orderNo}`);
    console.log(`Status DB   : ${o.status}`);
    console.log(`Shipments   : ${JSON.stringify(o.shipments)}`);
    const pkg = o.shipments.find((s) => s.externalId)?.externalId ?? undefined;
    const tracking = o.shipments.find((s) => s.trackingNo)?.trackingNo ?? undefined;
    console.log(`packageNumber: ${pkg ?? "(kosong)"}`);
    console.log(`trackingNumber: ${tracking ?? "(kosong)"}`);

    try {
      const acc = await loadShopeeAccount(o.accountId);
      if (!acc) { console.error("❌ Akun tidak ditemukan.\n"); continue; }
      const out = await withRefreshedToken(acc, async (token, shopId, creds) => {
        const steps: string[] = [];
        let suggestedType: string | undefined;
        try {
          const p = await getShippingDocumentParameter(token, shopId, o.orderNo, pkg, creds);
          suggestedType = String(p.suggest_shipping_document_type ?? "").trim() || undefined;
          steps.push(`parameter OK (suggest_type=${suggestedType ?? "-"}, keys=${Object.keys(p).join("|")})`);
        } catch (e) {
          steps.push(`parameter GAGAL: ${e instanceof Error ? e.message : String(e)}`);
        }
        try {
          await createShippingDocument(token, shopId, {
            order_sn: o.orderNo,
            ...(pkg ? { package_number: pkg } : {}),
            ...(tracking ? { tracking_number: tracking } : {}),
            ...(suggestedType ? { shipping_document_type: suggestedType } : {}),
          }, creds);
          steps.push("createShippingDocument OK");
        } catch (e) {
          steps.push(`createShippingDocument GAGAL: ${e instanceof Error ? e.message : String(e)}`);
        }
        for (let i = 0; i < 8; i++) {
          try {
            const r = await getShippingDocumentResult(token, shopId, o.orderNo, pkg, creds);
            const entry = Array.isArray(r.result_list) ? (r.result_list[0] as Record<string, unknown>) : r;
            const status = String(entry.status ?? entry.document_status ?? "").toUpperCase();
            steps.push(`result#${i} status=${status || "(kosong)"} raw=${JSON.stringify(entry).slice(0, 300)}`);
            if (["READY", "SUCCESS", "COMPLETED"].includes(status)) {
              const pdf = await downloadShippingDocument(token, shopId, o.orderNo, pkg, creds);
              const isPdf = pdf[0] === 0x25 && pdf[1] === 0x50 && pdf[2] === 0x44 && pdf[3] === 0x46;
              steps.push(`download OK: ${pdf.length} bytes, isPDF=${isPdf}`);
              return { steps, ok: true };
            }
            if (["FAILED", "ERROR"].includes(status)) {
              steps.push(`status gagal: ${JSON.stringify(entry).slice(0, 300)}`);
              return { steps, ok: false };
            }
          } catch (e) {
            steps.push(`result#${i} GAGAL: ${e instanceof Error ? e.message : String(e)}`);
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        return { steps, ok: false };
      });
      console.log(out.ok ? "✅ SUKSES" : "❌ BELUM SIAP");
      for (const s of out.steps) console.log("   - " + s);
    } catch (e) {
      console.error("❌ FATAL: " + (e instanceof Error ? e.message : String(e)));
    }
    console.log();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("Fatal:", e); process.exit(1); });
