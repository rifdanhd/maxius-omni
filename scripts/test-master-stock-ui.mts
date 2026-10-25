import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import type { MasterStockResult, MasterStockRow } from "../lib/inventory/master-stock.types";

const bundle = await build({
  stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import Page from "./components/inventory/master-stock-page"; createRoot(document.getElementById("root")).render(<Page/>);', resolveDir: process.cwd(), loader: "tsx" },
  tsconfig: "tsconfig.json", bundle: true, write: false, platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' },
});
const css = readdirSync(".next/static/css", { recursive: true }).filter((name) => String(name).endsWith(".css"))
  .map((name) => readFileSync(path.join(".next/static/css", String(name)), "utf8")).join("\n");
assert.ok(css.length > 10000, "Jalankan npm run build sebelum uji tampilan");
const server = http.createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].contents); }
  else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Server tidak tersedia");
const browser = await chromium.launch({ headless: true });
mkdirSync(".next-e2e/qa", { recursive: true });
try {
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const row: MasterStockRow = { id: "sku-1", version: 7, sku: "SOCK-BLACK", name: "Kaos kaki olahraga premium hitam ukuran dewasa", variantName: "Hitam / Dewasa", imageUrl: null,
      category: "Kaos kaki", stock: 1200, safetyStock: 10, available: 1190, pending: 2, minimum: 5, archived: false, ownArchived: false, promoActive: 0,
      status: "FAILED", allocationWarning: true, warehouses: [{ id: "warehouse-1", name: "Gudang utama", stock: 1200, safetyStock: 10 }],
      listings: [1, 2, 3].map((number) => ({ id: `listing-${number}`, accountId: `shop-${number}`, store: `Toko ${number}`, platform: number === 3 ? "TIKTOK_SHOP" : "SHOPEE",
        channelSku: `${1000 + number}:5`, sellerSku: "SOCK-BLACK", platformSkuId: `${1000 + number}:5`, platformStock: 1190,
        status: number === 2 ? "FAILED" : "SUCCESS", error: number === 2 ? "Toko fixture menolak stok" : null, lastSyncedAt: "2026-10-25T00:00:00Z",
        allocation: { mode: "FULL", value: 100, buffer: 0 }, inheritsAllocation: true, defaultAllocation: { mode: "FULL", value: 100, buffer: 0 }, quantity: 1190 })) };
    const body: MasterStockResult = { rows: [row], total: 3602, page: 1, pageSize: 50, counts: { all: 3602, empty: 0, low: 0, failed: 1, unmapped: 0, oversells: 0 },
      archivedCounts: { all: 20, empty: 10 }, filters: { categories: ["Kaos kaki"], stores: row.listings.map((listing) => ({ id: listing.accountId, label: listing.store, platform: listing.platform })),
        warehouses: [{ id: "warehouse-1", name: "Gudang utama", isDefault: true }] } };
    const posts: Array<Record<string, unknown>> = [];
    const queries: string[] = [];
    let conflict = true;
    await page.route("**/api/inventory/master-stock?*", (route) => {
      queries.push(new URL(route.request().url()).search);
      return route.fulfill({ json: body });
    });
    await page.route("**/api/inventory/master-stock", async (route) => {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      posts.push(input);
      if (input.action === "change" && conflict) return route.fulfill({ status: 409, json: { error: "Stok sudah diubah pengguna lain. Muat ulang." } });
      return route.fulfill({ json: { success: true } });
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await expect(page.getByTestId("master-stock-row")).toHaveCount(1);
    await expect(page.getByText("3 toko", { exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Promosi", exact: true })).toHaveCount(0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px: overflow halaman`);
    await page.getByRole("button", { name: "Rincian SOCK-BLACK" }).click();
    await expect(page.getByText("Toko fixture menolak stok", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sinkron ulang", exact: true }).nth(1).click();
    await expect.poll(() => posts.some((input) => input.action === "retry" && input.listingId === "listing-2")).toBe(true);
    const rowElement = page.getByTestId("master-stock-row");
    await rowElement.getByRole("button", { name: "Ubah stok", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Akan dikirim ke 3 listing di 3 toko.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Simpan perubahan" })).toBeDisabled();
    await dialog.getByLabel("Stok fisik akhir").fill("1234");
    await dialog.getByLabel("Alasan wajib").fill("Opname browser fixture");
    await dialog.getByRole("button", { name: "Simpan perubahan" }).click();
    await expect(dialog).toContainText("Stok sudah diubah pengguna lain");
    conflict = false;
    await dialog.getByRole("button", { name: "Simpan perubahan" }).click();
    await expect(dialog).toHaveCount(0);
    const change = posts.find((input) => input.action === "change")!;
    assert.equal((change.changes as Array<{ expectedVersion: number }>)[0].expectedVersion, 7);
    await page.getByRole("button", { name: "Atur alokasi" }).first().click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Aturan alokasi").selectOption("PERCENT");
    await dialog.getByLabel("Persentase (%)").fill("50");
    await dialog.getByLabel("Buffer pengaman listing").fill("10");
    await expect(dialog.getByRole("status")).toContainText("590");
    await dialog.getByRole("button", { name: "Simpan alokasi" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("tab", { name: /Sinkron gagal/ }).click();
    await expect.poll(() => queries.some((query) => query.includes("tab=failed"))).toBe(true);
    await page.getByLabel("Cari SKU atau nama produk").fill("SOCK");
    await expect.poll(() => queries.some((query) => query.includes("q=SOCK"))).toBe(true);
    await page.getByRole("button", { name: "Halaman berikutnya" }).click();
    await expect.poll(() => queries.some((query) => query.includes("page=2"))).toBe(true);
    await page.getByRole("button", { name: "Impor", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Impor");
    await page.getByRole("dialog").getByRole("button", { name: "Tutup", exact: true }).first().click();
    assert.deepEqual(errors, []);
    await page.locator('div[aria-busy]').evaluate((element) => { element.scrollLeft = 0; });
    await page.screenshot({ path: `.next-e2e/qa/master-stock-${width}.png`, fullPage: true });
    console.log(`PASS ${width}px: SKU master, 3 toko, kegagalan listing, konflik versi, alasan wajib, alokasi, filter, pagination, impor, tanpa overflow`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
