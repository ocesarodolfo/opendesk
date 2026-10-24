// Remove os dados de teste criados pelo smoke-test (Financeiro, agente@teste.local, numero "Suporte - Teste")
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const expired = await prisma.sector.deleteMany({ where: { name: "Financeiro" } });
const user = await prisma.user.deleteMany({ where: { email: "agente@teste.local" } });
const num = await prisma.whatsAppNumber.deleteMany({ where: { label: "Suporte - Teste" } });
console.log(`limpo: ${expired.count} setores, ${user.count} usuarios, ${num.count} numeros`);
await prisma.$disconnect();
