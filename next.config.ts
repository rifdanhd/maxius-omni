import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["maxius.id"],
  experimental: {
    serverComponentsExternalPackages: [],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.ibyteimg.com" },
      { protocol: "https", hostname: "**.tiktokcdn.com" },
      { protocol: "https", hostname: "**.tiktokcdn-us.com" },
    ],
  },
};

export default nextConfig;
