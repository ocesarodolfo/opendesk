import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { emitRealtime } from "@/lib/realtime";
import { canViewConversation, getSectorScope } from "@/lib/scope";
import { waManager } from "@/lib/whatsapp/manager";

// ---------------------------------------------------------------------------
// Reagir a uma mensagem da conversa (envia a reacao pelo WhatsApp e grava).
// Emoji "" = remove a reacao. Uma reacao por mensagem (a ultima vence).
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const emoji = typeof body.emoji === "string" ? body.emoji.trim().slice(0, 16) : "";
  if (!messageId) return NextResponse.json({ error: "Informe a mensagem." }, { status: 400 });

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      sectorId: true,
      whatsappNumberId: true,
      contact: { select: { jid: true, phone: true, isGroup: true } },
    },
  });
  if (!conversation) return NextResponse.json({ error: "Conversa inexistente." }, { status: 404 });

  const scope = await getSectorScope(session);
  if (!canViewConversation(scope, conversation.sectorId)) {
    return NextResponse.json({ error: "Sem permissao para esta conversa." }, { status: 403 });
  }

  const target = await prisma.message.findFirst({
    where: { id: messageId, conversationId: id },
    select: { id: true, direction: true, externalId: true, senderJid: true },
  });
  if (!target || !target.externalId) {
    return NextResponse.json({ error: "Mensagem inexistente." }, { status: 404 });
  }

  // toggle: clicar novamente na mesma emoji remove a reacao
  const existing = await prisma.message.findUnique({
    where: { id: target.id },
    select: { reaction: true },
  });
  const removing = existing?.reaction === emoji;

  const chatJid = conversation.contact.jid ?? `${conversation.contact.phone}@s.whatsapp.net`;
  try {
    await waManager.sendReaction(
      conversation.whatsappNumberId,
      chatJid,
      target.externalId,
      target.direction === "OUTGOING",
      conversation.contact.isGroup && target.direction === "INCOMING" ? target.senderJid : null,
      removing ? "" : emoji
    );
  } catch (error) {
    console.error("[react] falha ao enviar reacao:", error);
    return NextResponse.json(
      { error: "Nao conectado: a reacao nao pode ser enviada agora." },
      { status: 503 }
    );
  }

  const updated = await prisma.message.update({
    where: { id: target.id },
    data: { reaction: removing ? null : emoji, reactionMine: removing ? null : true },
    select: { id: true, reaction: true, reactionMine: true },
  });

  emitRealtime({
    type: "message:update",
    conversationId: id,
    sectorId: conversation.sectorId,
    message: { id: updated.id, reaction: updated.reaction, reactionMine: updated.reactionMine },
  });
  return NextResponse.json(updated);
}
