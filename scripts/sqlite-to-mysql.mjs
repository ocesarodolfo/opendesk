// =====================================================================
// Migração de dados SQLite -> MySQL (una vez, produção) — docs/10
//
// Uso:
//   1. gere o client sqlite e rode este script com --yes:
//        npm run db:generate
//        node scripts/sqlite-to-mysql.mjs --yes
//
//   Requisitos:
//   - SQLITE_DATABASE_URL (default file:./data/app.db relativo a prisma/)
//   - MYSQL_DATABASE_URL   ex.: mysql://user:senha@host:3306/central
//
//   O script:
//     fase A: regenera o PrismaClient p/ sqlite e despeja JSON temporário
//     fase B: regenera o PrismaClient p/ mysql e insere com os IDs originais
//   (o provider do Prisma e' fixado no schema, entao alternamos o generate.)
//   Processo idempotente: apaga (deleteMany) antes de inserir, na ordem certa.
// =====================================================================
import { execSync, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const HERE = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ROOT = path.resolve(HERE, "..");
const TMP = path.resolve("C:/Users/rodol/AppData/Local/Temp/opencode", "migrate-dump.json");

const stage = process.argv[2] ?? "";

// -------------------------------------------------------------- fase A
if (stage !== "--write") {
  const yes = process.argv.includes("--yes");
  if (!yes) {
    console.error(
      "ATENCAO: este script APAGA os dados atuais do MySQL (deleteMany) antes de inserir.\n" +
      "Confirme com:  node scripts/sqlite-to-mysql.mjs --yes"
    );
    process.exit(1);
  }

  const sqliteUrl = process.env.SQLITE_DATABASE_URL ?? "file:./data/app.db";
  process.env.DATABASE_URL = sqliteUrl;

  console.log("[A] gerando client sqlite...");
  execSync("npx prisma generate", { cwd: ROOT, stdio: "inherit" });
  const { PrismaClient } = await import("@prisma/client");
  const sqlite = new PrismaClient({ datasources: { db: { url: sqliteUrl } } });

  // Ordem das tabelas: pais antes de filhos (FKs)
  const plan = [
    ["sector", (db) => db.sector],
    ["user", (db) => db.user],
    ["whatsAppNumber", (db) => db.whatsAppNumber],
    ["contact", (db) => db.contact],
    ["tag", (db) => db.tag],
    ["quickReply", (db) => db.quickReply],
    ["sectorMembership", (db) => db.sectorMembership],
    ["conversation", (db) => db.conversation],
    ["message", (db) => db.message],
    ["contactTag", (db) => db.contactTag],
    ["auditLog", (db) => db.auditLog],
  ];

  const dump = {};
  for (const [key, pick] of plan) {
    const rows = await pick(sqlite).findMany();
    dump[key] = rows;
    console.log(`    ${key}: ${rows.length} linha(s)`);
  }
  await sqlite.$disconnect();

  writeFileSync(TMP, JSON.stringify(dump), "utf8");
  console.log(`[A] dump guardado em ${TMP}`);

  console.log("[B] gerando client mysql... (os dados sao inseridos num novo processo)");
  execSync("npx prisma generate --schema prisma/schema.mysql.prisma", { cwd: ROOT, stdio: "inherit" });
  const res = spawnSync(process.execPath, [import.meta.filename, "--write", TMP], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, DUMP_FILE: TMP },
  });
  if (res.status !== 0) {
    console.error("[B] FALHOU — dados do sqlite ficam intactos; rode novamente depois de ajustar.");
    process.exit(res.status ?? 1);
  }
  // volta o client de desenvolvimento
  console.log("[~] restaurando client sqlite (desenvolvimento)...");
  execSync("npx prisma generate", { cwd: ROOT, stdio: "inherit" });
  rmSync(TMP, { force: true });
  process.exit(0);
}

// -------------------------------------------------------------- fase B
if (stage === "--write") {
  const { PrismaClient } = await import("@prisma/client");
  const mysqlUrl =
    process.env.MYSQL_DATABASE_URL ??
    process.env.DATABASE_URL ??
    (() => {
      throw new Error("Defina MYSQL_DATABASE_URL (mysql://user:senha@host:3306/database)");
    })();
  const mysql = new PrismaClient({ datasources: { db: { url: mysqlUrl } } });

  const dump = JSON.parse(process.env.DUMP_FILE);
  const insert = [
    ["sector", (db) => db.sector],
    ["user", (db) => db.user],
    ["whatsAppNumber", (db) => db.whatsAppNumber],
    ["contact", (db) => db.contact],
    ["tag", (db) => db.tag],
    ["quickReply", (db) => db.quickReply],
    ["sectorMembership", (db) => db.sectorMembership],
    ["conversation", (db) => db.conversation],
    ["message", (db) => db.message],
    ["contactTag", (db) => db.contactTag],
    ["auditLog", (db) => db.auditLog],
  ];
  // apagar na ordem reversa (filhos antes de pais)
  for (const [key, pick] of [...insert].reverse()) {
    const n = await pick(mysql).deleteMany();
    if (n.count) console.log(`    limpo ${key}: ${n.count}`);
  }
  for (const [key, pick] of insert) {
    const rows = dump[key] ?? [];
    for (let i = 0; i < rows.length; i += 500) {
      await pick(mysql).createMany({ data: rows.slice(i, i + 500) });
    }
    console.log(`    inserido ${key}: ${rows.length}`);
  }
  await mysql.$disconnect();
  console.log("[B] migracao concluida.");
}
