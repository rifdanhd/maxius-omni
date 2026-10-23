import { prisma } from "../lib/db/prisma";
import { loadShopeeAccount, withRefreshedToken } from "../lib/services/marketplace-shopee.service";
import { getShippingParameter } from "../lib/integrations/shopee";

async function main() {
  console.log("=== Diagnosa Pengiriman Pesanan Shopee ===");

  const orders = await prisma.order.findMany({
    where: { account: { platform: "SHOPEE" } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, orderNo: true, status: true, accountId: true, createdAt: true },
  });

  if (orders.length === 0) {
    console.log("Tidak ada pesanan Shopee ditemukan di database.");
    return;
  }

  console.log(`Ditemukan ${orders.length} pesanan Shopee terbaru:\n`);

  for (const o of orders) {
    console.log(`--------------------------------------------------`);
    console.log(`Order ID   : ${o.id}`);
    console.log(`Order No   : ${o.orderNo}`);
    console.log(`Status DB  : ${o.status}`);
    console.log(`Dibuat     : ${o.createdAt.toISOString()}`);

    try {
      const acc = await loadShopeeAccount(o.accountId);
      if (!acc) {
        console.error(`❌ Akun Shopee (${o.accountId}) tidak ditemukan.`);
        continue;
      }
      console.log(`Akun Toko  : ${acc.label} (ShopID: ${acc.externalShopId})`);
      console.log(`Token Exp  : ${acc.tokenExpiresAt?.toISOString() ?? "null"}`);

      const res = await withRefreshedToken(acc, (t, s, c) =>
        getShippingParameter(t, s, o.orderNo, c)
      );
      console.log(`✅ SUKSES! Opsi pengiriman dari Shopee:`);
      console.log(JSON.stringify(res, null, 2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ GAGAL memanggil get_shipping_parameter:`);
      console.error(`   ${msg}`);
    }
  }
  console.log(`--------------------------------------------------`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
