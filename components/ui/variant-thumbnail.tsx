"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VariantThumbnailProps {
  /** Gambar varian/listing (prioritas utama). Kosong = langsung ke fallback. */
  src?: string | null;
  /** Gambar cadangan, biasanya cover MasterProduct (imageUrl). */
  fallbackSrc?: string | null;
  /** Nama varian/produk untuk teks alternatif; kosong = gambar dekoratif. */
  alt?: string;
  /** Sisi kotak thumbnail dalam px. Ukuran tetap agar layout tidak bergeser. */
  size?: number;
  className?: string;
}

const isImageUrl = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value.trim());

/**
 * VariantThumbnail — satu aturan gambar varian untuk semua halaman:
 * gambar varian → gambar MasterProduct → placeholder ikon netral.
 * Kegagalan muat (URL rusak/403) pindah ke kandidat berikutnya, bukan ikon rusak,
 * dan kotak berukuran tetap sehingga baris tidak bergeser.
 */
export function VariantThumbnail({ src, fallbackSrc, alt = "", size = 40, className }: VariantThumbnailProps) {
  // Kegagalan dilacak per URL, jadi data yang berubah tidak mewarisi status lama.
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const candidates = [src, fallbackSrc].filter(isImageUrl);
  const current = candidates.find((url) => !failed.has(url)) ?? null;

  return (
    <span
      data-testid="variant-thumbnail"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground",
        className
      )}
      style={{ width: size, height: size }}
    >
      <Package aria-hidden="true" style={{ width: Math.round(size * 0.4), height: Math.round(size * 0.4) }} />
      {current && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={current}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed((prev) => new Set(prev).add(current))}
        />
      )}
    </span>
  );
}
