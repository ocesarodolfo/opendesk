import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { waManager, buildWireMentionText, type OutgoingMentionInput } from "@/lib/whatsapp/manager";
import { emitRealtime } from "@/lib/realtime";
import { canViewConversation, getSectorScope } from "@/lib/scope";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

// Apagar mensagem "para todos": envia REVOKE ao WhatsApp e marca no banco
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  const messageId = req.nextUrl.searchParams.get("messageId");

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { contact: true, whatsappNumber: true },
  });
  if (!conversation) return NextResponse.json({ error: "Conversa inexistente." }, { status: 404 });
  const scope = await getSectorScope(session);
  if (!canViewConversation(scope, conversation.sectorId)) {
    return NextResponse.json({ error: "Sem permissao para esta conversa." }, { status: 403 });
  }

  const message = await prisma.message.findFirst({
    where: { id: messageId ?? "", conversationId: id },
  });
  if (!message) return NextResponse.json({ error: "Mensagem inexistente." }, { status: 404 });
  if (message.deleted) return NextResponse.json({ ok: true }); // idempotente
  if (message.direction !== "OUTGOING") {
    return NextResponse.json(
      { error: "So e possivel apagar mensagens enviadas pelo painel." },
      { status: 400 }
    );
  }
  if (!message.externalId) {
    return NextResponse.json(
      { error: "Mensagem sem referencia no WhatsApp (provavelmente falhou o envio)." },
      { status: 409 }
    );
  }

  try {
    await waManager.deleteMessage(
      conversation.whatsappNumberId,
      conversation.contact.jid ?? `${conversation.contact.phone.replace(/\D/g, "")}@s.whatsapp.net`,
      message.externalId,
      true,
      conversation.contact.isGroup ? message.senderJid : null
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao apagar no WhatsApp." },
      { status: 502 }
    );
  }

  const updated = await prisma.message.update({
    where: { id: message.id },
    data: { deleted: true },
  });

  emitRealtime({
    type: "message:update",
    conversationId: id,
    sectorId: conversation.sectorId,
    message: { id: updated.id, deleted: true },
  });

  void auditLog({
    action: AUDIT_ACTIONS.MENSAGEM_APAGADA,
    entity: "Conversation",
    entityId: id,
    detail: `apagada a msg ${message.id}`,
    session,
    req,
  });

  return NextResponse.json({ ok: true });
}

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

  const validMentions: OutgoingMentionInput[] = Array.isArray(body.mentions)
    ? body.mentions.filter(
        (m: unknown): m is OutgoingMentionInput =>
          Boolean(
            m &&
              typeof m === "object" &&
              typeof (m as OutgoingMentionInput).jid === "string" &&
              typeof (m as OutgoingMentionInput).displayName === "string"
          )
      )
    : [];

  try {
    // prefixo do atendente em LINHA PROPRIA (a mensagem desce para a 2a linha)
    const prefix = conversation.whatsappNumber.prefixAgent
      ? `[${session.name}]\n`
      : "";
    const { wireText, mentionedJids } =
      conversation.contact.isGroup && validMentions.length > 0
        ? buildWireMentionText(text, validMentions)
        : { wireText: text, mentionedJids: [] };

    const { externalId } = await waManager.sendMessage(
      conversation.whatsappNumberId,
      conversation.contact.phone,
      `${prefix}${wireText}`,
      conversation.contact.jid,
      mentionedJids.length > 0 ? mentionedJids : undefined
    );

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        direction: "OUTGOING",
        content: `${prefix}${text}`,
        externalId,
        status: "SENT",
        // resposta a outra mensagem (menu de acoes): guarda a citacao para
        // exibir o "quote" na bolha no painel (o WhatsApp nao a recebe)
        quotedSnippet:
          typeof body.replySnippet === "string" && body.replySnippet.trim()
            ? body.replySnippet.trim().slice(0, 200)
            : null,
        quotedSenderName:
          typeof body.replyName === "string" && body.replyName.trim()
            ? body.replyName.trim().slice(0, 80)
            : null,
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
        quotedSnippet: message.quotedSnippet,
        quotedSenderName: message.quotedSenderName,
        createdAt: message.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar mensagem.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
