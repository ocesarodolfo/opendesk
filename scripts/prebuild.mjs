import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

  // O optimize-node-modules.sh da Wasmer apaga arquivos com permissao +x que nao sejam .wasm.
  // Bibliotecas .so.node carregadas via dlopen precisam apenas de 0644.
  const prismaClientDir = path.join(process.cwd(), "node_modules", ".prisma", "client");
  if (fs.existsSync(prismaClientDir)) {
    for (const entry of fs.readdirSync(prismaClientDir)) {
      if (entry.endsWith(".node")) {
        fs.chmodSync(path.join(prismaClientDir, entry), 0o644);
      }
    }
  }
}

