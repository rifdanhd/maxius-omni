export function safeStockPushMessage(value: unknown, secrets: Array<string | null | undefined> = []): string {
  if (value && typeof value === "object" && "code" in value && value.code === "P2022") return "Skema pengaturan push stok belum siap (P2022); migrasi inventori perlu diterapkan sebelum pengiriman dapat diverifikasi.";
  let message = value instanceof Error ? value.message : String(value);
  for (const secret of secrets) if (secret && secret.length >= 6) message = message.split(secret).join("[REDACTED]");
  return message.replace(/https?:\/\/[^\s]+/gi, "[URL dihapus]")
    .replace(/((?:access_?token|refresh_?token|app_?secret|client_?secret|partner_?key|authorization|x-tts-access-token|sign)["']?\s*[:=]\s*["']?)[^\s,"'&}]+/gi, "$1[REDACTED]").slice(0, 2000);
}
