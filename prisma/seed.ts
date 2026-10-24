// Popula o banco com o primeiro usuario ADMIN.
// Uso: npm run db:seed
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@empresa.local" },
    update: {},
    create: {
      name: "Administrador",
      email: "admin@empresa.local",
      passwordHash,
      role: "ADMIN",
    },
  });

  const setor = await prisma.sector.upsert({
    where: { name: "Suporte Geral" },
    update: {},
    create: { name: "Suporte Geral", description: "Setor padrao de suporte" },
  });

  await prisma.sectorMembership.upsert({
    where: { userId_sectorId: { userId: admin.id, sectorId: setor.id } },
    update: {},
    create: { userId: admin.id, sectorId: setor.id, role: "ADMIN" },
  });

  console.log("Seed concluido:");
  console.log("  Login  : admin@empresa.local");
  console.log("  Senha  : admin123  (troque depois na gestao de usuarios)");
  console.log(`  Setor  : ${setor.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
