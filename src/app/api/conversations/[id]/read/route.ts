import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getSectorScope, canViewConversation } from "@/lib/scope";
import { emitRealtime } from "@/lib/realtime";

// Marca como lidas as mensagens INCOMING nao vistas da conversa — chamado
// quando um atendente abre a conversa no painel (badges zeram, como o WA)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: { sectorId: true, status: true },
  });
  if (!conversation) return NextResponse.json({ error: "Conversa inexistente." }, { status: 404 });
  const scope = await getSectorScope(session);
  if (!canViewConversation(scope, conversation.sectorId)) {
    return NextResponse.json({ error: "Sem permissao para esta conversa." }, { status: 403 });
  }

  const result = await prisma.message.updateMany({
    where: { conversationId: id, direction: "INCOMING", viewed: false },
    data: { viewed: true },
  });

  if (result.count > 0) {
    // avisa outros paineis abertos da MESMA conversa p/ zerar o badge
    emitRealtime({
      type: "conversation:read",
      conversationId: id,
      sectorId: conversation.sectorId,
      message: { count: result.count },
    });
  }

  return NextResponse.json({ marked: result.count });
}
