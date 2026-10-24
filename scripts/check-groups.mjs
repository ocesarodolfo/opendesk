// Inspecao rapida de grupos no banco (suporte)
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const groups = await p.contact.findMany({
  where: { isGroup: true },
  select: { name: true, phone: true, jid: true },
});
console.log("grupos:", JSON.stringify(groups, null, 1));
const msgs = await p.message.findMany({
  where: { senderName: { not: null } },
  select: { senderName: true, createdAt: true, conversationId: true },
  orderBy: { createdAt: "desc" },
  take: 5,
});
console.log("ultimas msgs de grupo:", msgs.map((m) => `${m.senderName} @ ${m.createdAt.toISOString()}`));
await p.$disconnect();
