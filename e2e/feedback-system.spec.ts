import { test, expect, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import jwt from "jsonwebtoken";
import { sql } from "./helpers";

const PATH = "/products/marketplace/shopee";
const SYNC = "**/api/marketplace/shopee/products/sync";
const list = { rows: [{ key: "shop-1|100", accountId: "shop-1", accountLabel: "Toko Kaos Kaki", platformProductId: "100", platformTitle: "Kaos Kaki Bola", channelSku: "SOCK", stockTotal: 0, variantCount: 1, variantId: "v1", status: "NORMAL", mappingStatus: "connected" }], total: 1, accounts: [{ id: "shop-1", label: "Toko Kaos Kaki" }], counts: { all: 1 }, syncProductCount: 100 };
let token: string;
const errors = new WeakMap<Page, string[]>();

test.beforeAll(() => {
  loadEnvConfig(process.cwd());
  const user = JSON.parse(sql(`SELECT json_build_object('id', id, 'tokenVersion', "tokenVersion") FROM "User" WHERE username='admin'`));
  token = jwt.sign({ sub: user.id, username: "admin", businessId: "business-default", tokenVersion: user.tokenVersion }, process.env.JWT_SECRET!, { expiresIn: "1h" });
});
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.context().addCookies([{ name: "maxius_session", value: token, url: "http://localhost:3100", httpOnly: true }]);
  await page.route("**/api/marketplace/shopee/products?*", (route) => route.fulfill({ json: list }));
  await page.route("**/api/stock-alerts", (route) => route.fulfill({ json: { alerts: [], reminder: null } }));
  await page.route("**/api/sync-jobs?*", (route) => route.fulfill({ json: { rows: [], nextCursor: null } }));
  await page.route("**/api/stores", (route) => route.fulfill({ json: [{ id: "shop-1", name: "Toko Kaos Kaki", platform: "SHOPEE", status: "connected" }] }));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function sync(page: Page) {
  await page.getByRole("button", { name: "Perbarui Data", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Perbarui sekarang", exact: true }).click();
  await expect(page.getByRole("button", { name: "Perbarui Data", exact: true })).toBeEnabled();
}

for (const variant of [{ theme: "light", width: 1280 }, { theme: "dark", width: 320 }]) {
  test(`error sinkron menetap, detail tersembunyi, dan tutup manual: ${variant.theme} ${variant.width}`, async ({ page }) => {
    await page.setViewportSize({ width: variant.width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((theme) => localStorage.setItem("vite-ui-theme", theme), variant.theme);
    await page.route(SYNC, (route) => route.fulfill({ json: { ok: true, accounts: [{ label: "Toko Kaos Kaki", error: "[Shopee] error_auth: token expired access_token=secret-fixture req-123" }] } }));
    await page.goto(PATH);
    await sync(page);
    const toast = page.locator('[data-app-toast="error"]');
    const banner = page.locator('[data-feedback="error"]').filter({ hasText: "Sinkron gagal" });
    await expect(toast).toHaveAttribute("role", "alert");
    await expect(toast).toContainText("Koneksi toko perlu diperbarui");
    await expect(toast.getByRole("button", { name: "Perbarui koneksi" })).toBeVisible();
    await expect(toast.locator("pre")).not.toBeVisible();
    await expect(banner).toBeVisible();
    await page.mouse.move(0, 899);
    await page.waitForTimeout(6200);
    await expect(toast).toBeVisible();
    await toast.getByText("Lihat detail", { exact: true }).click();
    await expect(toast.locator("pre")).toContainText("error_auth");
    await expect(toast.locator("pre")).not.toContainText("secret-fixture");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/feedback-${variant.theme}-${variant.width}.png`, fullPage: true });
    await toast.getByRole("button", { name: "Tutup notifikasi" }).click();
    await expect(toast).toHaveCount(0);
    await expect(banner).toBeVisible();
    await banner.getByRole("link", { name: "Perbarui koneksi" }).click();
    await expect(page).toHaveURL(/\/settings\/accounts/);
  });
}

test("toast sukses menutup otomatis dan maksimum tiga pesan ditampilkan", async ({ page }) => {
  let failed = false;
  await page.route(SYNC, (route) => route.fulfill({ json: { ok: true, accounts: failed ? [{ label: "Toko Kaos Kaki", error: "Gagal memperbarui data. Coba lagi." }] : [{ label: "Toko Kaos Kaki", items: 24, models: 24, matched: 24 }] } }));
  await page.goto(PATH);
  await sync(page);
  const success = page.locator('[data-app-toast="success"]');
  await expect(success).toHaveAttribute("role", "status");
  await expect(success).toContainText("24 varian diperbarui");
  expect(await success.locator("svg").count()).toBeGreaterThan(0);
  await page.mouse.move(0, 899);
  await expect(success).toHaveCount(0, { timeout: 8000 });
  failed = true;
  for (let index = 0; index < 4; index++) {
    await page.getByTestId("shopee-product-row").getByRole("button", { name: "Aksi Kaos Kaki Bola" }).click();
    await page.getByRole("menuitem", { name: "Sinkron produk ini" }).click();
    await expect(page.locator('[data-feedback="error"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Perbarui Data", exact: true })).toBeEnabled();
  }
  await expect(page.locator("[data-app-toast]")).toHaveCount(3);
});

test("lonceng: 9+, kelompok waktu, tandai dibaca, persistensi dan navigasi", async ({ page }) => {
  const alerts = Array.from({ length: 12 }, (_, index) => ({ variantId: `v${index}`, variantSku: `SKU-${index}`, productName: `Produk ${index}`, effectiveStock: index === 0 ? 0 : 2, severity: index === 0 ? "out" : "low" }));
  await page.route("**/api/stock-alerts", (route) => route.fulfill({ json: { alerts, reminder: null } }));
  await page.route("**/api/stores", (route) => route.fulfill({ json: [{ id: "expired", name: "Toko Kedaluwarsa", status: "expired", tokenExpiresAt: "2026-01-01T00:00:00Z" }] }));
  const jobs = [1, 4].map((days) => ({ id: `job-${days}`, status: "FAILED", retryCount: 3, updatedAt: new Date(Date.now() - days * 86400000).toISOString(), account: { label: "Toko Gagal" }, variant: { productName: "Produk Gagal" } }));
  await page.route("**/api/sync-jobs?*", (route) => route.fulfill({ json: { rows: jobs, nextCursor: null } }));
  await page.goto(PATH);
  const bell = page.getByRole("button", { name: /^Notifikasi/ });
  await expect(bell).toContainText("9+");
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Pusat notifikasi" });
  for (const group of ["Hari ini", "Kemarin", "Sebelumnya"]) await expect(panel.getByRole("heading", { name: group })).toBeVisible();
  await expect(panel.getByRole("link").first()).toContainText("Stok habis");
  await panel.getByRole("button", { name: "Tandai semua dibaca" }).click();
  await expect(panel.getByText("Belum dibaca", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(bell).toBeFocused();
  await page.reload();
  await expect(bell).not.toContainText("9+");
  await bell.click();
  await expect(panel.getByRole("button", { name: "Tandai semua dibaca" })).toBeDisabled();
  await panel.getByRole("link").filter({ hasText: "Koneksi toko kedaluwarsa" }).click();
  await expect(page).toHaveURL(/\/settings\/accounts/);
});

test("lonceng membedakan kosong dari gagal dimuat dan dapat dicoba lagi di HP", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let failed = true;
  await page.route("**/api/stock-alerts", (route) => route.fulfill(failed ? { status: 503, json: { error: "fixture" } } : { json: { alerts: [], reminder: null } }));
  await page.goto(PATH);
  await page.getByRole("button", { name: /^Notifikasi/ }).click();
  const panel = page.getByRole("dialog", { name: "Pusat notifikasi" });
  await expect(panel).toContainText("Sebagian notifikasi belum dimuat");
  await expect(panel.getByText("Belum ada notifikasi", { exact: true })).toHaveCount(0);
  failed = false;
  await panel.getByRole("button", { name: "Coba lagi" }).click();
  await expect(panel).toContainText("Belum ada notifikasi");
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});

test("hapus toko memakai konfirmasi, batal tidak mengirim request, error dapat ditutup", async ({ page }) => {
  let deletes = 0;
  await page.route("**/api/stores/shop-1", (route) => { deletes++; return route.fulfill({ status: 500, json: { error: "fixture" } }); });
  await page.goto("/settings/accounts");
  const remove = page.getByRole("button", { name: /hapus/i }).first();
  await remove.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Toko Kaos Kaki");
  await expect(dialog.getByRole("button", { name: "Hapus", exact: true })).toHaveClass(/bg-destructive/);
  await dialog.getByRole("button", { name: "Batal" }).click();
  expect(deletes).toBe(0);
  await remove.click();
  await dialog.getByRole("button", { name: "Hapus", exact: true }).click();
  await expect(page.locator('[data-app-toast="error"]')).toBeVisible();
  expect(deletes).toBe(1);
});

test("login: error di bawah field terhubung ke input untuk pembaca layar", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Masuk Sekarang" }).click();
  await expect(page.getByLabel("Username", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Username", { exact: true })).toHaveAttribute("aria-describedby", "username-error");
  await expect(page.locator("#username-error")).toHaveAttribute("role", "alert");
  await expect(page.locator("#password-error")).toContainText("Isi password");
});

test("dashboard gagal dimuat menampilkan pesan dan tombol coba lagi", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/summary", (route) => {
    requests++;
    return route.fulfill({ status: 503, json: { error: "fixture" } });
  });
  await page.route("**/api/analytics", (route) => route.fulfill({ status: 503, json: { error: "fixture" } }));
  await page.route("**/api/dashboard/kpi", (route) => route.fulfill({ status: 503, json: { error: "fixture" } }));
  await page.goto("/dashboard");
  const error = page.getByRole("alert").filter({ hasText: "Ringkasan belum dapat dimuat" });
  await expect(error).toBeVisible();
  const initial = requests;
  await error.getByRole("button", { name: "Coba lagi" }).click();
  await expect.poll(() => requests).toBeGreaterThan(initial);
  await expect(error).toBeVisible();
});

test("pengembalian membedakan sukses, tanpa toko, dan gagal sebagian", async ({ page }) => {
  let mode = "success";
  await page.route("**/api/returns?*", (route) => route.fulfill({ json: { returns: [], total: 0 } }));
  await page.route("**/api/returns/sync", (route) => route.fulfill({ json: {
    results: mode === "empty" ? [] : mode === "error" ? [{ label: "Toko Kaos Kaki", error: "error_auth: token expired access_token=secret-fixture" }] : [{ label: "Toko Kaos Kaki" }],
  } }));
  await page.goto("/orders/returns");
  const syncButton = page.getByRole("button", { name: "Perbarui Pengembalian (Sinkron Retur)" });
  await syncButton.click();
  await expect(page.locator('[data-feedback="success"]')).toContainText("Data pengembalian selesai diperbarui");
  await expect(syncButton).toBeEnabled();
  mode = "empty";
  await syncButton.click();
  await expect(page.locator('[data-feedback="warning"]')).toContainText("Belum ada toko aktif");
  await expect(syncButton).toBeEnabled();
  mode = "error";
  await syncButton.click();
  const error = page.locator('[data-feedback="error"]');
  await expect(error).toContainText("Sebagian pengembalian belum berhasil diperbarui");
  await expect(error.locator("pre")).not.toBeVisible();
  await error.getByText("Lihat detail", { exact: true }).click();
  await expect(error.locator("pre")).toContainText("error_auth");
  await expect(error.locator("pre")).not.toContainText("secret-fixture");
});
