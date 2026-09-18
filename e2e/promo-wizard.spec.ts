import { test, expect } from '@playwright/test';

const SHOT = (n: string) =>
  `/Users/udan/Downloads/maxius-project/maxius-platform/e2e/screenshots/promo-${n}.png`;

function parseRp(text: string): number[] {
  const m = text.match(/Rp\s?([\d.]+)/g) ?? [];
  return m.map((s) => Number(s.replace(/[^\d]/g, '')));
}

function plusHours(h: number): string {
  const d = new Date(Date.now() + h * 3600_000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

test('A: wizard campaign promosi TikTok end-to-end', async ({ page }) => {
  // 1. Login.
  await page.goto('/login');
  await page.getByPlaceholder('Masukkan username').fill('admin');
  await page.getByPlaceholder('••••••••').fill('admin123');
  await page.getByRole('button', { name: 'Masuk Sekarang' }).click();
  await page.waitForURL('/dashboard', { timeout: 30_000, waitUntil: 'commit' });
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 60_000 });

  // 2. Step 1: pilih toko + 1 produk.
  await page.goto('/promotions/create');
  await expect(page.getByRole('heading', { name: 'Buat Promosi Baru' })).toBeVisible({
    timeout: 30_000,
  });
  const storeSelect = page.locator('select').first();
  await expect
    .poll(async () => storeSelect.locator('option').count(), { timeout: 30_000 })
    .toBeGreaterThan(1);
  // Jangan hardcode index toko: tidak semua toko seed punya listing aktif.
  // Pilih toko PERTAMA yang benar-benar menampilkan >=1 checkbox listing.
  const listingBoxes = page.locator('div.m-4 input[type="checkbox"]');
  const storeCount = await storeSelect.locator('option').count();
  let pickedStore = -1;
  for (let i = 0; i < storeCount; i++) {
    await storeSelect.selectOption({ index: i });
    try {
      await expect
        .poll(async () => listingBoxes.count(), { timeout: 10_000 })
        .toBeGreaterThan(0);
      pickedStore = i;
      break;
    } catch {
      // Toko ini kosong — coba toko berikutnya.
    }
  }
  expect(pickedStore, 'minimal 1 toko harus punya listing aktif').toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: SHOT('a1-step1-listings') });
  await listingBoxes.first().check();
  // Harga belum di-set -> isi inline agar bisa lanjut.
  const savePriceBtn = page.getByRole('button', { name: 'Simpan harga' });
  if ((await savePriceBtn.count()) > 0) {
    await page.locator('input[placeholder="100000"]').first().fill('100000');
    await savePriceBtn.first().click();
    await expect(savePriceBtn).toHaveCount(0, { timeout: 30_000 });
  }
  const lanjut1 = page.getByRole('button', { name: 'Lanjut ke Diskon & Jadwal' });
  await expect(lanjut1).toBeEnabled({ timeout: 15_000 });
  await lanjut1.click();

  // 3. Step 2: jadwal + preview.
  await expect(page.getByRole('button', { name: 'Preview Harga Akhir' })).toBeVisible({
    timeout: 15_000,
  });
  await page.locator('input[type="datetime-local"]').fill(plusHours(3));
  await page.screenshot({ path: SHOT('a2-step2-form') });
  await page.getByRole('button', { name: 'Preview Harga Akhir' }).click();
  // Tunggu harga akhir muncul di minimal 1 baris.
  const finalCell = page.locator('td', { hasText: /→ Rp/ }).first();
  await expect(finalCell).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: SHOT('a3-step2-preview') });

  // Verifikasi matematika: final ≈ listingMin * (100 - diskon)/100.
  const row = page.locator('tbody tr', { hasText: /→ Rp/ }).first();
  const discount = Number(await row.locator('input[type="number"]').first().inputValue());
  const cells = row.locator('td');
  const hargaText = await cells.nth(2).innerText();
  const listingPart = hargaText.split('→')[0] ?? '';
  const listingNums = parseRp(listingPart);
  expect(listingNums.length).toBeGreaterThan(0);
  const listed = Math.min(...listingNums);
  const finalPart = hargaText.split('→')[1] ?? '';
  const finalNums2 = parseRp(finalPart);
  expect(finalNums2.length).toBeGreaterThan(0);
  const actual = Math.min(...finalNums2);
  const expected = Math.round((listed * (100 - discount)) / 100);
  expect(
    Math.abs(actual - expected),
    `final ${actual} vs expected ${expected} (listing ${listed}, diskon ${discount}%)`
  ).toBeLessThanOrEqual(Math.max(2, Math.round(expected * 0.01)));

  // 4. Gate checkbox kondisional -> tombol Lanjut.
  const lanjut2 = page.getByRole('button', { name: 'Lanjut ke Konfirmasi' });
  const extremeBox = page.getByText('Saya sudah membaca peringatan di atas dan tetap ingin lanjut.');
  if ((await extremeBox.count()) > 0) {
    await expect(lanjut2).toBeDisabled();
    await extremeBox.click();
  }
  const overlapBox = page.getByText('Tetap lanjutkan meski ada tumpang tindih.');
  if ((await overlapBox.count()) > 0) {
    await expect(lanjut2).toBeDisabled();
    await overlapBox.click();
  }
  await expect(lanjut2).toBeEnabled({ timeout: 15_000 });
  await page.screenshot({ path: SHOT('a4-step2-gate-open') });
  await lanjut2.click();

  // 5. Step 3: type-to-confirm.
  const confirmInput = page.getByPlaceholder('BUAT');
  await expect(confirmInput).toBeVisible({ timeout: 15_000 });
  const submitBtn = page.getByRole('button', { name: 'Ya, Buat Promosi Sekarang' });
  await confirmInput.fill('buat');
  await expect(submitBtn).toBeDisabled();
  await confirmInput.fill('BUAT ');
  await expect(submitBtn).toBeDisabled();
  await page.screenshot({ path: SHOT('a5-confirm-rejects-typo') });
  await confirmInput.fill('BUAT');
  await expect(submitBtn).toBeEnabled();
  await page.screenshot({ path: SHOT('a6-confirm-accepts') });

  // 6. Submit -> hasil tampil jelas.
  await submitBtn.click();
  const success = page.getByText('Promosi berhasil dibuat & terverifikasi.');
  const unverified = page.getByText(/perlu pengecekan manual/);
  const failed = page.getByText('Promosi TIDAK jadi dibuat.');
  await expect(success.or(unverified).or(failed)).toBeVisible({ timeout: 180_000 });
  await page.screenshot({ path: SHOT('a7-create-result') });
});
