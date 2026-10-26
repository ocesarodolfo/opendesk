import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { waManager } from "@/lib/whatsapp/manager";
import { emitRealtime } from "@/lib/realtime";
import { canViewConversation, getSectorScope } from "@/lib/scope";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

// Envio de mensagem textual pelo atendente
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const text = typeof body.content === "string" ? body.content.trim().slice(0, 4096) : "";
  if (!text) return NextResponse.json({ error: "Mensagem vazia." }, { status: 400 });

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { contact: true, whatsappNumber: true },
  });
  if (!conversation) return NextResponse.json({ error: "Conversa inexistente." }, { status: 404 });
  if (conversation.status === "CLOSED") {
    return NextResponse.json({ error: "Conversa encerrada." }, { status: 409 });
  }
  const scope = await getSectorScope(session);
  if (!canViewConversation(scope, conversation.sectorId)) {
    return NextResponse.json({ error: "Sem permissao para esta conversa." }, { status: 403 });
  }

  try {
    const { externalId } = await waManager.sendMessage(
      conversation.whatsappNumberId,
      conversation.contact.phone,
      text,
      conversation.contact.jid
    );

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        direction: "OUTGOING",
        content: text,
        externalId,
        status: "SENT",
      },
    });

    await prisma.conversation.update({
      where: { id },
      data: { lastMessageAt: message.createdAt },
    });

    emitRealtime({
      type: "message:new",
      conversationId: id,
      message: { ...message, conversationStatus: conversation.status },
    });

    void auditLog({
      action: AUDIT_ACTIONS.MENSAGEM_ENVIADA,
      entity: "Conversation",
      entityId: id,
      detail: `enviada a ${conversation.contact.name || conversation.contact.phone}: ${text.slice(0, 80)}`,
      session,
      req,
    });

    return NextResponse.json({
      message: {
        id: message.id,
        direction: message.direction,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar mensagem.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
