import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baileys/Pino/Qrcode nao devem ser empacotados pelo bundler do Next
  serverExternalPackages: ["@whiskeysockets/baileys", "pino", "qrcode"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
