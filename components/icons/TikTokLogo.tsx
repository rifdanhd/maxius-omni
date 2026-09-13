import React from "react";
import Image from "next/image";

/**
 * TikTokLogo — Logo TikTok Shop.
 * Dipakai sebagai ikon kecil; object-contain agar rasio asli dipertahankan.
 */
export default function TikTokLogo({
  size = 14,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/Logo/tiktok-VG_PDGFU.png"
      alt="TikTok Shop"
      width={120}
      height={80}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: "auto", height: size }}
    />
  );
}