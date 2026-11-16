import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL && process.env.DB_HOST) {
  const user = encodeURIComponent(process.env.DB_USERNAME ?? "");
  const pass = encodeURIComponent(process.env.DB_PASSWORD ?? "");
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT || "3306";
  const db = process.env.DB_NAME ?? "";
  process.env.DATABASE_URL = `mysql://${user}:${pass}@${host}:${port}/${db}`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
