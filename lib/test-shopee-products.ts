import { prisma } from "./db/prisma";
import { getItemList } from "./integrations/shopee";
import { loadShopeeAccount, withRefreshedToken } from "./services/marketplace-shopee.service";

async function main() {
  console.log("=== CEK PRODUK SHOPEE (DB VS SHOPEE API) ===\n");

  const accounts = await prisma.platformAccount.findMany({
    where: { platform: "SHOPEE" },
    select: {
      id: true,
      label: true,
      externalShopId: true,
      accessToken: true,
      isFrozen: true,
      productMapping: {
        select: {
          id: true,
          channelSku: true,
          platformProductId: true,
          platformStatus: true,
          variantId: true,
        },
      },
    },
  });

  if (accounts.length === 0) {
    console.log("Tidak ada akun Shopee ditemukan di database.");
    return;
  }

  for (const acc of accounts) {
    console.log(`----------------------------------------`);
    console.log(`Toko: ${acc.label} (Shop ID: ${acc.externalShopId ?? "-"}, ID: ${acc.id})`);
    console.log(`Total ProductMapping di Database lokal: ${acc.productMapping.length}`);
    const connected = acc.productMapping.filter((m) => m.variantId !== null).length;
    const unlinked = acc.productMapping.filter((m) => m.variantId === null).length;
    console.log(`  - Terhubung ke Stok Pusat: ${connected}`);
    console.log(`  - Belum terhubung (orphan): ${unlinked}`);

    const uniqueProductIdsInDb = new Set(
      acc.productMapping.map((m) => m.platformProductId).filter(Boolean)
    );
    console.log(`  - Jumlah ID Produk Shopee unik di DB: ${uniqueProductIdsInDb.size}`);

    if (!acc.accessToken || !acc.externalShopId) {
      console.log(`⚠️ Akun belum login/OAuth Shopee (accessToken kosong).`);
      continue;
    }

    try {
      const shopeeAcc = await loadShopeeAccount(acc.id);
      if (!shopeeAcc) {
        console.log("⚠️ Gagal memuat akun Shopee.");
        continue;
      }

      console.log("\nMemeriksa langsung ke Shopee Open API v2...");

      // 1. Cek status NORMAL (Aktif)
      const resNormal = await withRefreshedToken(shopeeAcc, (token, shopId, creds) =>
        getItemList(token, shopId, { offset: 0, pageSize: 50, itemStatus: ["NORMAL"] }, creds)
      );
      console.log(`  📦 Total produk status NORMAL (Aktif) di Shopee API: ${resNormal.totalCount}`);

      // 2. Cek status UNLIST (Diarsipkan / Disembunyikan)
      try {
        const resUnlist = await withRefreshedToken(shopeeAcc, (token, shopId, creds) =>
          getItemList(token, shopId, { offset: 0, pageSize: 50, itemStatus: ["UNLIST"] }, creds)
        );
        console.log(`  📦 Total produk status UNLIST (Diarsipkan) di Shopee API: ${resUnlist.totalCount}`);
      } catch (err) {
        // Shopee API might ignore or error if unlist not supported
      }

      // 3. Cek status BANNED
      try {
        const resBanned = await withRefreshedToken(shopeeAcc, (token, shopId, creds) =>
          getItemList(token, shopId, { offset: 0, pageSize: 50, itemStatus: ["BANNED"] }, creds)
        );
        console.log(`  📦 Total produk status BANNED di Shopee API: ${resBanned.totalCount}`);
      } catch (err) {
        // ignore
      }

      console.log(`\nContoh produk pertama dari Shopee:`);
      for (const item of resNormal.items.slice(0, 5)) {
        console.log(`  - Item ID: ${item.item_id}, Status: ${item.item_status}`);
      }
    } catch (e) {
      console.error(`❌ Gagal panggil Shopee API:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`----------------------------------------\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
