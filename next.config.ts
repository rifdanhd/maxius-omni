import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.MAXIUS_OFFICE_BUILD_CHECK === "1" ? { typescript: { tsconfigPath: "tsconfig.office-check.json" } } : {}),
  outputFileTracingExcludes: {
    "/*": ["./app/office/**/*", "./lib/agent-office/**/*", "./scripts/*office*", "./.agent-office/**/*"],
  },
  env: {
    NEXT_PUBLIC_ENABLE_OFFICE:
      process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_ENABLE_OFFICE === "true"
        ? "true"
        : "false",
  },
  // Next 16 hanya mengizinkan SATU `next dev` per direktori proyek
  // (lockfile di <distDir>/dev/lock) — server e2e tidak bisa jalan berdampingan
  // dengan `npm run dev` biasa. Dengan distDir terpisah, lock & artefak build
  // juga terpisah sehingga keduanya bisa hidup bersamaan.
  ...(process.env.MAXIUS_OFFICE_BUILD_CHECK === "1"
    ? { distDir: ".next-office-check" }
    : process.env.MAXIUS_E2E === "1" ? { distDir: ".next-e2e" } : {}),
  allowedDevOrigins: ["maxius.id"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.ibyteimg.com" },
      { protocol: "https", hostname: "**.tiktokcdn.com" },
      { protocol: "https", hostname: "**.tiktokcdn-us.com" },
    ],
  },
};

export default nextConfig;
