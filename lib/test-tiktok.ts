import { ClientConfiguration, TikTokShopNodeApiClient } from "./tiktok-sdk";

// Kredensial HANYA dari environment — jangan hardcode app key/secret di sini.
ClientConfiguration.globalConfig.app_key = process.env.TIKTOK_APP_KEY ?? "";
ClientConfiguration.globalConfig.app_secret = process.env.TIKTOK_APP_SECRET ?? "";

const client = new TikTokShopNodeApiClient({
  config: {
    basePath: "https://open-api-sandbox.tiktokglobalshop.com", // pakai sandbox dulu sesuai akun test kamu
  },
});

console.log("Client berhasil dibuat:", !!client);
