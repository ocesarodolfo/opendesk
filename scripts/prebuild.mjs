import { spawnSync } from "node:child_process";

/**
 * Na Wasmer (Anybuild), ANYBUILD_EDGEJS_ENGINE e' definido no Dockerfile.
 * Gera o Prisma Client para MySQL automaticamente antes do `next build`
 * sem afetar o fluxo local (SQLite).
 */
const isWasmerOrMysql =
  Boolean(process.env.ANYBUILD_EDGEJS_ENGINE) ||
  Boolean(process.env.WASMER) ||
  Boolean(process.env.DB_HOST) ||
  Boolean(process.env.DATABASE_URL?.startsWith("mysql://"));

if (isWasmerOrMysql) {
  console.log("[prebuild] Gerando Prisma Client para MySQL...");
  const res = spawnSync(
    "npx",
    ["prisma", "generate", "--schema", "prisma/schema.mysql.prisma"],
    {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    }
  );
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

