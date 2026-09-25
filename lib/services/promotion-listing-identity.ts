/**
 * Identitas varian listing promo — pure function, tanpa React & tanpa DB.
 *
 * KONTEKS BUG (Batch 3): `ProductMapping.variantId` boleh NULL (listing belum
 * di-mapping). Kode UI sempat memakai `variantId` mentah sebagai key state
 * (priceDraft), React key, dan matcher baris → dua produk unmapped sama-sama
 * `null` sehingga `null === null` = true → draft harga saling tabrakan dan
 * update harga produk A bisa ke-apply ke produk B.
 *
 * SATU sumber identitas: `mappingId` (PK ProductMapping) — selalu ada dan
 * selalu unik per baris, termasuk saat `variantId` null. Jangan dicampur
 * dengan `variantId ?? channelSku`: campuran itu bisa tabrakan balik bila
 * ada `variantId` yang kebetulan sama dengan `channelSku` milik baris lain.
 */

export type ListingVariantIdentity = {
  /** PK ProductMapping — satu-satunya sumber identitas di module ini. */
  mappingId: string;
  /** Boleh null (unmapped). TIDAK dipakai untuk key/matching. */
  variantId?: string | null;
};

/** Key state / React key yang unik walau `variantId` null. */
export function variantIdentityKey(v: ListingVariantIdentity): string {
  return v.mappingId;
}

/** Matching baris-varian — hanya membandingkan `mappingId`. */
export function isSameVariant(a: ListingVariantIdentity, b: ListingVariantIdentity): boolean {
  return a.mappingId === b.mappingId;
}

/** Tulis draft (mis. input harga) untuk SATU varian tanpa menyentuh varian lain. */
export function setVariantDraft(
  draft: Record<string, string>,
  v: ListingVariantIdentity,
  value: string
): Record<string, string> {
  return { ...draft, [variantIdentityKey(v)]: value };
}

/** Update harga optimistis per varian target; varian lain tidak berubah. */
export function applyVariantPrice<T extends ListingVariantIdentity>(
  variants: T[],
  target: ListingVariantIdentity,
  price: number
): T[] {
  return variants.map((v) => (isSameVariant(v, target) ? { ...v, price } : v));
}
