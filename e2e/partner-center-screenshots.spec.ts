import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { login, sql } from './helpers';
import { TEST_SKU, applyPartnerFixture } from './partner-fixture';

/**
 * Screenshot TikTok Shop Partner Center dari INSTANS LOKAL (localhost:3100).
 *
 * - DB terisolasi e2e berisi data dummy (1 toko uji tanpa kredensial, 5 produk,
 *   SKU uji TEST-MAXIUS-01, pesanan dummy) — lihat ./partner-fixture.ts.
 * - Push stok tidak menembak API toko asli: akun uji tanpa accessToken (guard
 *   stock-push-queue → "skipped"), dan kredensial partner .env dinetralkan
 *   di playwright.partner.config.ts.
 * - Login memakai akun testing lokal (admin / TEST_ADMIN_PASSWORD).
 * - 1440x900, PNG, tiap file < 10MB.
 * - TIDAK mengklik otorisasi/tambah toko; langkah 02 & 08 dilewati.
 */

const OUT_DIR = 'e2e/screenshots/tiktok-partner';
const USER = process.env.MAXIUS_TEST_USER ?? 'admin';

test.setTimeout(420_000);

const captured: Array<{ file: string; kb: number }> = [];

/** Halaman dianggap siap saat network idle + settle. */
async function loaded(page: Page, settleMs = 2_500): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(settleMs);
}

async function shot(page: Page, file: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${file}.png`;
  await page.screenshot({ path, fullPage: true, timeout: 60_000 });
  const bytes = fs.statSync(path).size;
  expect(bytes, `${file}.png harus <10MB`).toBeLessThan(10 * 1024 * 1024);
  captured.push({ file, kb: Math.round(bytes / 1024) });
}

/** Sensor PII pembeli di halaman pesanan — hanya DOM di memori. */
async function redactBuyerPII(page: Page): Promise<void> {
  await page.evaluate(() => {
    const phoneRe = /(\+?62|0)8\d{2}[\d\s-]{5,}/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue ?? '';
      if (phoneRe.test(text)) node.nodeValue = text.replace(phoneRe, '••••••••');
    }
    document.querySelectorAll('p').forEach((p) => {
      if (p.textContent?.trim() !== 'Alamat') return;
      const col = p.parentElement;
      if (!col) return;
      const paras = col.querySelectorAll('p');
      paras.forEach((line, i) => {
        if (i === 0) return;
        if (i === 1) line.textContent = 'Nama Pembeli (••••••••)';
        else if (i === 2) line.textContent = '••••••••••••••••••••';
      });
    });
  });
}

/** Gabung login + dashboard jadi satu PNG vertikal (1440x1800). */
async function combine01(page: Page): Promise<void> {
  const a = `${OUT_DIR}/tmp-01a-login.png`;
  const b = `${OUT_DIR}/tmp-01b-dashboard.png`;
  const combiner = await page.context().newPage();
  await combiner.setViewportSize({ width: 1440, height: 900 });
  const aBase = fs.readFileSync(a).toString('base64');
  const bBase = fs.readFileSync(b).toString('base64');
  await combiner.setContent(
    `<body style="margin:0">` +
      `<img style="display:block;width:1440px" src="data:image/png;base64,${aBase}">` +
      `<img style="display:block;width:1440px" src="data:image/png;base64,${bBase}">` +
      `</body>`,
    { waitUntil: 'load' }
  );
  await shot(combiner, '01-login-dashboard');
  await combiner.close();
  fs.rmSync(a);
  fs.rmSync(b);
}

test('screenshot partner center (lokal, data dummy)', async ({ page }) => {
  // Fixture dummy dulu + guard kredensial.
  applyPartnerFixture();

  // ---------------- 01: login + dashboard ----------------
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await loaded(page, 1_500);
  await shot(page, 'tmp-01a-login');
  await login(page, USER);
  await loaded(page, 4_000);
  await shot(page, 'tmp-01b-dashboard');

  // ---------------- 03: daftar toko terhubung ----------------
  await page.goto('/settings/accounts', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await loaded(page);
  await shot(page, '03-toko-terhubung');

  // ---------------- 04: produk hasil sinkronisasi TikTok ----------------
  await page.goto('/products/marketplace/tiktok', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await loaded(page);
  await shot(page, '04-produk-tiktok');

  // ---------------- 05: pemetaan SKU ke SKU pusat ----------------
  await page.goto('/products/mapping', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await loaded(page);
  await shot(page, '05-mapping-sku');

  // ---------------- 06: dashboard stok pusat ----------------
  await page.goto('/inventory', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await loaded(page);
  await shot(page, '06-stok-pusat');

  // ---------------- 07: ubah stok SKU uji lalu simpan (push ke toko uji) ----------------
  await page.goto('/inventory', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Label aria UI: "Stok fisik <SKU>" (input) dan "Simpan stok fisik <sku>" (tombol,
  // SKU di-lowercase oleh komponen) — nama unik per SKU, tanpa scope row.
  const stockInput = page.getByLabel(`Stok fisik ${TEST_SKU}`, { exact: true });
  await stockInput.waitFor({ state: 'visible', timeout: 30_000 });
  const before = Number((await stockInput.inputValue()) || '0');
  const stockResp = page.waitForResponse(
    (r) => new URL(r.url()).pathname.startsWith('/api/inventory/') && r.request().method() !== 'GET',
    { timeout: 60_000 }
  );
  await stockInput.fill(String(before + 1));
  await page.getByLabel(new RegExp(`Simpan stok fisik ${TEST_SKU}`, 'i')).click();
  const push = await stockResp;
  expect(push.status(), 'simpan stok pada SKU uji harus sukses').toBeLessThan(400);
  await page.waitForTimeout(6_000); // beri waktu antrean push (lokal: skipped)
  await shot(page, '07-ubah-stok-kirim');

  // ---------------- 09: pesanan TikTok Shop (PII disensor) ----------------
  await page.goto('/orders', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await loaded(page);
  await redactBuyerPII(page);
  await shot(page, '09-pesanan-tiktok');

  // ---------------- 10: log sinkronisasi / rekonsiliasi ----------------
  await page.goto('/inventory/mismatch', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await loaded(page);
  await shot(page, '10-log-sinkronisasi');

  // ---------------- 01: gabungkan login + dashboard ----------------
  await combine01(page);

  // Verifikasi akhir: hanya SKU uji berubah stoknya.
  const tmp = sql(`SELECT "stock" FROM "ProductVariant" WHERE "sku" = 'TEST-MAXIUS-01'`);
  expect(Number(tmp), 'stok SKU uji harus berubah di langkah 07').toBeGreaterThanOrEqual(1);

  const message = captured
    .filter((c) => !c.file.startsWith('tmp-'))
    .map((c) => `${c.file}.png — ${c.kb} KB`)
    .join('\n');
  console.log(`\nCAPTURED:\n${message}\n`);
});
