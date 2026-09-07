import { ClientConfiguration, TikTokShopNodeApiClient } from "./tiktok-sdk";

ClientConfiguration.globalConfig.app_key = "6l6ht2ppn0v3n";
ClientConfiguration.globalConfig.app_secret = "GANTI_DENGAN_APP_SECRET_ASLI";

const client = new TikTokShopNodeApiClient({
  config: {
    basePath: "https://open-api-sandbox.tiktokglobalshop.com", // pakai sandbox dulu sesuai akun test kamu
  },
});

console.log("Client berhasil dibuat:", !!client);