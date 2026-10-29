import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import type { MasterStockRow } from "../lib/inventory/master-stock.types";
const row: MasterStockRow = {
  id: "fixture", version: 0, sku: "FIXTURE", name: "Produk fixture", variantName: null, imageUrl: null, category: null,
  stock: 100, safetyStock: 10, available: 90, pending: 0, minimum: 5, archived: false, ownArchived: false, promoActive: 0, status: "DISABLED", allocationWarning: false,
  warehouses: [{ id: "w", name: "Gudang utama", stock: 100, safetyStock: 10 }],
  listings: [{ id: "l", accountId: "store", store: "Toko fixture", platform: "SHOPEE", channelSku: "100:1", sellerSku: "FIXTURE", platformSkuId: "1", platformStock: 75,
    status: "DISABLED", error: null, blockedReason: "Push stok dinonaktifkan untuk toko ini.", lastSyncedAt: null,
    allocation: { mode: "FULL", value: 100, buffer: 0 }, defaultAllocation: { mode: "FULL", value: 100, buffer: 0 }, quantity: 90, inheritsAllocation: true }],
};
const bundle = await build({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";import Settings from "./app/(dashboard)/inventory/settings/page";import Stores from "./components/settings/StoreIntegration";import {MasterStockListings} from "./components/inventory/master-stock-listings";createRoot(document.getElementById("root")).render(<><Settings/><MasterStockListings row={${JSON.stringify(row)}} busy={false} allocate={()=>{}} retry={()=>{}} message={()=>{}}/><Stores/></>);`, resolveDir: process.cwd(), loader: "tsx" }, tsconfig: "tsconfig.json", bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
const css = readdirSync(".next/static/css", { recursive: true }).filter((name) => String(name).endsWith(".css")).map((name) => readFileSync(path.join(".next/static/css", String(name)), "utf8")).join("\n");
const server = http.createServer((req, res) => {
  if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].contents); }
  else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); if (!address || typeof address === "string") throw new Error("Server fixture tidak tersedia.");
const browser = await chromium.launch({ headless: true });
mkdirSync(".next-e2e/qa", { recursive: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let saved: Record<string, unknown> | undefined;
    const settings = { lowStockDefaultThreshold: 5, notifyLowStock: true, notifyLowStockEmail: false, stockPushEnabled: true, syncPushShopee: true, syncPushTiktok: true, syncPushTokopedia: false, opnameReminderFrequency: "monthly" };
    await page.route("**/api/inventory/settings", async (route) => {
      if (route.request().method() === "PUT") saved = route.request().postDataJSON();
      await route.fulfill({ json: { settings: saved ?? settings, pushRuntime: { globalEnabled: false } } });
    });
    let storeEnabled = true;
    await page.route("**/api/stores", (route) => route.fulfill({ json: [{ id: "store", name: "Toko fixture", platform: "SHOPEE", status: "connected", stockPushEnabled: storeEnabled }, { id: "other-store", name: "Toko lain", platform: "TIKTOK_SHOP", status: "connected", stockPushEnabled: false }] }));
    await page.route("**/api/stores/store", async (route) => { storeEnabled = route.request().postDataJSON().stockPushEnabled; await route.fulfill({ json: { success: true, id: "store", stockPushEnabled: storeEnabled } }); });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await expect(page.getByText("Push stok sedang dinonaktifkan pada server.", { exact: false })).toBeVisible();
    await expect(page.getByText("Push nonaktif", { exact: true })).toBeVisible();
    await expect(page.getByText("Push stok dinonaktifkan untuk toko ini.", { exact: true })).toBeVisible();
    const shopee = page.locator("label").filter({ has: page.getByText("Shopee", { exact: true }) }).getByRole("switch");
    await expect(shopee).toBeEnabled(); await shopee.click();
    await page.getByRole("button", { name: "Simpan Pengaturan" }).click();
    await expect.poll(() => saved?.syncPushShopee).toBe(false);
    assert.equal(saved?.stockPushEnabled, true, "Mengubah toggle platform tidak mengubah gate brand");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.getByRole("button", { name: "Nonaktifkan push stok Toko fixture", exact: true }).click();
    await expect(page.getByRole("button", { name: "Aktifkan push stok Toko fixture", exact: true })).toBeVisible();
    assert.equal(storeEnabled, false);
    await page.getByRole("button", { name: "Aktifkan push stok Toko fixture", exact: true }).click();
    await expect(page.getByRole("button", { name: "Nonaktifkan push stok Toko fixture", exact: true })).toBeVisible();
    assert.equal(storeEnabled, true);
    await expect(page.getByRole("button", { name: "Aktifkan push stok Toko lain", exact: true })).toBeVisible();
    await page.route("**/api/stores/store", (route) => route.fulfill({ status: 403, json: { error: "Akses ditolak." } }));
    await page.getByRole("button", { name: "Nonaktifkan push stok Toko fixture", exact: true }).click();
    await expect(page.getByText("Akses ditolak.", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Nonaktifkan push stok Toko fixture", exact: true })).toBeEnabled();
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `.next-e2e/qa/stock-sync-settings-${width}.png`, fullPage: true });
    console.log(`PASS ${width}px: gate server, pengaturan brand/platform, Shopee dapat diubah, alasan nonaktif listing, tanpa overflow`);
    await page.close();
  }
} finally { await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }
