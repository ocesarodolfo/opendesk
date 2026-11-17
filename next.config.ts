import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baileys/Pino/Qrcode nao devem ser empacotados pelo bundler do Next
  serverExternalPackages: ["@whiskeysockets/baileys", "pino", "qrcode", "@prisma/client", "web-push"],
  outputFileTracingIncludes: {
    "/**/*": ["./node_modules/.prisma/client/**/*"],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
