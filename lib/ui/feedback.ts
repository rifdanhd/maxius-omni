export type FeedbackVariant = "success" | "warning" | "error" | "info" | "neutral";

export const feedbackStyles: Record<FeedbackVariant, string> = {
  success: "border-success/30 bg-success-subtle text-success",
  warning: "border-warning/30 bg-warning-subtle text-warning",
  error: "border-destructive/30 bg-destructive-subtle text-destructive",
  info: "border-info/30 bg-info-subtle text-info",
  neutral: "border-border bg-muted text-muted-foreground",
};

export const feedbackTitles: Record<FeedbackVariant, string> = {
  success: "Berhasil", warning: "Perlu perhatian", error: "Belum berhasil",
  info: "Informasi", neutral: "Pemberitahuan",
};

export function safeDetails(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text
    .replace(/\b(Bearer)\s+\S+/gi, "$1 [disembunyikan]")
    .replace(/((?:access_token|refresh_token|password|secret|authorization|partner_key)["']?\s*[:=]\s*["']?)[^\s,"'&}]+/gi, "$1[disembunyikan]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[sesi disembunyikan]")
    .slice(0, 4000);
}

export function friendlyError(value: unknown, fallback = "Tindakan belum berhasil. Silakan coba lagi."): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  if (/token.*(expir|invalid)|expir.*token|error_auth|unauthoriz|invalid.*token/i.test(raw)) return "Koneksi toko perlu diperbarui. Hubungkan kembali toko melalui Pengaturan Toko.";
  if (/rate.?limit|too many requests|\b429\b/i.test(raw)) return "Marketplace sedang membatasi permintaan. Tunggu sebentar, lalu coba lagi.";
  if (/network|failed to fetch|fetch failed|ECONN|timeout|timed out/i.test(raw)) return "Koneksi sedang terganggu. Periksa jaringan, lalu coba lagi.";
  if (/forbidden|permission denied|\b403\b/i.test(raw)) return "Anda belum memiliki izin untuk tindakan ini. Hubungi admin bisnis.";
  if (!raw || /HTTP|\b[45]\d{2}\b|\bAPI\b|prisma|SQL|stack|error[_:]|req-|exception|undefined|\{.*\}|\bfailed\b|invalid_|missing_|bad_request|internal.server/i.test(raw)) return fallback;
  return safeDetails(raw).replace(/\bsync\b/gi, "sinkron").replace(/\bfield\b/gi, "kolom");
}
