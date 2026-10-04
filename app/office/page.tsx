import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata =
  process.env.NEXT_PUBLIC_ENABLE_OFFICE === "true" && process.env.NODE_ENV === "development"
    ? { title: "Little Office — Kantor Agen", description: "Kantor virtual pixel art untuk memantau agen coding." }
    : { title: "404 — Maxius.id", robots: { index: false, follow: false } };

export default async function OfficePage() {
  if (process.env.NEXT_PUBLIC_ENABLE_OFFICE === "true" && process.env.NODE_ENV === "development") {
    const { default: Office } = await import("./office");
    return <Office />;
  }
  notFound();
}
