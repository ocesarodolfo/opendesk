import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getSectorScope, conversationVisibilityFilter } from "@/lib/scope";

// Total de mensagens NAO LIDAS (INCOMING sem "viewed") no escopo do usuario —
// alimenta o badge do item "Inbox" na sidebar (poll leve)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  const scope = await getSectorScope(session);

  const groups = await prisma.message.groupBy({
    by: ["conversationId"],
    where: {
      direction: "INCOMING",
      viewed: false,
      conversation: { AND: [conversationVisibilityFilter(scope), { status: { not: "CLOSED" } }] },
    },
    _count: { id: true },
  });

  return NextResponse.json({
    total: groups.reduce((acc, g) => acc + g._count.id, 0),
    conversations: groups.length,
  });
}
