import { spawnSync } from "node:child_process";

/**
 * Monta DATABASE_URL a partir das variaveis DB_* injetadas pela Wasmer
 * quando DATABASE_URL nao estiver definida explicitamente.
 */
function ensureDatabaseUrl() {
  if (!process.env.DATABASE_URL && process.env.DB_HOST) {
    const user = encodeURIComponent(process.env.DB_USERNAME ?? "");
    const pass = encodeURIComponent(process.env.DB_PASSWORD ?? "");
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT || "3306";
    const db = process.env.DB_NAME ?? "";
    process.env.DATABASE_URL = `mysql://${user}:${pass}@${host}:${port}/${db}`;
  }
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

ensureDatabaseUrl();

if (process.env.DATABASE_URL?.startsWith("mysql://")) {
  run("npx", [
    "prisma",
    "db",
    "push",
    "--schema",
    "prisma/schema.mysql.prisma",
    "--skip-generate",
  ]);
}

run("npx", ["next", "start"]);

