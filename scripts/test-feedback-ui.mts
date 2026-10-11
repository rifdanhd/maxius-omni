import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { friendlyError, safeDetails } from "../lib/ui/feedback";
import { notificationGroup, notificationStorageKey, reconcileNotifications, relativeNotificationTime, type NotificationItem } from "../lib/ui/notifications";

const warning: NotificationItem = { id: "stock:one", title: "Stok menipis", description: "Produk A", href: "/inventory", severity: "warning", source: "stock", fingerprint: "low" };
const now = "2026-10-11T02:00:00.000Z";

test("pembaruan rutin mempertahankan status dibaca dan waktu deteksi", () => {
  const first = reconcileNotifications([warning], {}, now);
  first.memory[warning.id].read = true;
  const next = reconcileNotifications([{ ...warning, description: "Sisa stok berubah" }], first.memory, "2026-10-12T02:00:00Z");
  assert.equal(next.rows[0].read, true);
  assert.equal(next.rows[0].detectedAt, now);
  assert.equal(first.rows[0].description, "Produk A");
});

test("stok berubah dari menipis menjadi habis kembali ditandai belum dibaca", () => {
  const first = reconcileNotifications([warning], {}, now);
  first.memory[warning.id].read = true;
  const next = reconcileNotifications([{ ...warning, fingerprint: "out", severity: "error" }], first.memory, "2026-10-12T02:00:00Z");
  assert.equal(next.rows[0].read, false);
});

test("peringatan selesai dibuang; kejadian berulang menjadi baru", () => {
  const first = reconcileNotifications([warning], {}, now);
  const resolved = reconcileNotifications([], first.memory, now);
  assert.deepEqual(resolved.memory, {});
  assert.equal(reconcileNotifications([warning], resolved.memory, now).rows[0].read, false);
});

test("penyimpanan dibatasi pengguna dan bisnis", () => {
  assert.notEqual(notificationStorageKey("admin", "one"), notificationStorageKey("admin", "two"));
  assert.notEqual(notificationStorageKey("admin", "one"), notificationStorageKey("staff", "one"));
  assert.notEqual(notificationStorageKey("a:b", "c"), notificationStorageKey("a", "b:c"));
});

test("kelompok tanggal memakai hari Jakarta, termasuk batas tengah malam", () => {
  const date = new Date("2026-10-10T17:05:00Z");
  assert.equal(notificationGroup("2026-10-10T17:01:00Z", date), "Hari ini");
  assert.equal(notificationGroup("2026-10-10T16:59:00Z", date), "Kemarin");
  assert.equal(notificationGroup("2026-10-08T17:00:00Z", date), "Sebelumnya");
});

test("waktu relatif tidak menghasilkan waktu masa depan akibat perbedaan jam", () => {
  assert.equal(relativeNotificationTime(now, Date.parse(now) - 60000), "Baru saja");
  assert.match(relativeNotificationTime(now, Date.parse(now) + 120000), /2 menit/);
});

test("error teknis menjadi pesan yang bisa ditindaklanjuti", () => {
  assert.match(friendlyError("[Shopee] error_auth: token expired req-123"), /Koneksi toko perlu diperbarui/);
  assert.match(friendlyError("HTTP 429"), /Tunggu sebentar/);
  assert.match(friendlyError("PrismaClientKnownRequestError: SQL"), /Silakan coba lagi/);
  assert.equal(friendlyError("Nama produk wajib diisi."), "Nama produk wajib diisi.");
});

test("detail teknis menyembunyikan kredensial", () => {
  const output = safeDetails('access_token=abc123 refresh_token=def456 password=secret123 Authorization: Bearer abc.xyz.def');
  for (const secret of ["abc123", "def456", "secret123", "abc.xyz.def"]) assert.ok(!output.includes(secret));
});

test("token teks status memenuhi kontras AA pada latar semantik terang dan gelap", () => {
  const css = fs.readFileSync("app/theme.css", "utf8");
  const luminance = (hex: string) => {
    const values = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  for (const selector of [":root", ".dark"]) {
    const block = css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[a-fA-F0-9]{6});/g)].map((match) => [match[1], match[2]]));
    for (const name of ["success", "warning", "destructive", "info", "muted"]) {
      const foreground = name === "muted" ? tokens["muted-foreground"] : tokens[name];
      const background = name === "muted" ? tokens.muted : tokens[`${name}-subtle`];
      const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      assert.ok((light + 0.05) / (dark + 0.05) >= 4.5, `${selector} ${name}`);
    }
  }
});
