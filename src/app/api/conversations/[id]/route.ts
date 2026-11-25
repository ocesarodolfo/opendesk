import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { toConversationDTO } from "@/lib/dto";
import { emitRealtime } from "@/lib/realtime";
import { canChangeSector, canViewConversation, getSectorScope } from "@/lib/scope";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";
import { waManager } from "@/lib/whatsapp/manager";

// include compartilhado (a chamada inline em findUnique reprovava no tsc 5.9)
const conversationInclude = {
  contact: { include: { tags: { include: { tag: true } } } },
  whatsappNumber: true,
  sector: true,
  assignedUser: { select: { name: true } },
} as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: conversationInclude,
  });
  if (!conversation) return NextResponse.json({ error: "Conversa inexistente." }, { status: 404 });

  // escopo por setor: fora do escopo nao abre detalhe/mensagens
  const scope = await getSectorScope(session);
  if (!canViewConversation(scope, conversation.sectorId)) {
    return NextResponse.json({ error: "Sem permissao para esta conversa." }, { status: 403 });
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  const rawMapped = messages.map((m) => ({
    id: m.id,
    direction: m.direction,
    content: m.content,
    status: m.status,
    mediaUrl: m.mediaUrl,
    mediaType: m.mediaType,
    fileName: m.fileName,
    senderName: m.senderName,
    quotedSnippet: m.quotedSnippet,
    quotedSender: m.quotedSender,
    quotedSenderName: m.quotedSenderName,
    forwarded: m.forwarded,
    reaction: m.reaction,
    reactionMine: m.reactionMine,
    deleted: m.deleted,
    groupKey: m.groupKey,
    externalId: m.externalId,
    createdAt: m.createdAt.toISOString(),
  }));

  const finalMessages = conversation.contact.isGroup
    ? await waManager.resolveStoredGroupMentions(
        conversation.whatsappNumberId,
        conversation.contact.jid ?? `${conversation.contact.phone.replace(/\D/g, "")}@g.us`,
        id,
        rawMapped,
        conversation.whatsappNumber.phone
      )
    : rawMapped;

  return NextResponse.json({
    conversation: toConversationDTO(conversation),
    messages: finalMessages,
  });
}

// atualizacao de status (iniciar atendimento/encerrar) e atribuicao de agente
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const existing = await prisma.conversation.findUnique({
    where: { id },
    select: { sectorId: true, status: true, assignedUserId: true },
  });
  if (!existing) return NextResponse.json({ error: "Conversa inexistente." }, { status: 404 });

  const scope = await getSectorScope(session);
  if (!canViewConversation(scope, existing.sectorId)) {
    return NextResponse.json({ error: "Sem permissao para esta conversa." }, { status: 403 });
  }

  const data: {
    status?: string;
    assignedUserId?: string | null;
    sectorId?: string | null;
  } = {};

  if (typeof body.status === "string" && ["PENDING", "OPEN", "CLOSED"].includes(body.status)) {
    data.status = body.status;
  }
  if (body.assignedUserId === null || typeof body.assignedUserId === "string") {
    data.assignedUserId = body.assignedUserId;
  }
  if (body.sectorId === null || typeof body.sectorId === "string") {
    if (!canChangeSector(session)) {
      return NextResponse.json(
        { error: "Apenas administradores movem conversa de setor." },
        { status: 403 }
      );
    }
    data.sectorId = body.sectorId;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  const updated = await prisma.conversation.update({
    where: { id },
    data: {
      ...data,
      // quem inicia o atendimento assume automaticamente a conversa
      ...(data.status === "OPEN" && !data.assignedUserId ? { assignedUserId: session.sub } : {}),
      // relatorios: quando fechou / voltou a ficar aberta
      ...(data.status === "CLOSED" ? { closedAt: new Date() } : {}),
      ...(data.status === "OPEN" || data.status === "PENDING" ? { closedAt: null } : {}),
    },
    include: conversationInclude,
  });

  emitRealtime({
    type: "conversation:update",
    conversationId: id,
    sectorId: updated.sectorId,
    status: updated.status,
  });

  // auditoria: registra o que efetivamente mudou
  if (data.status && data.status !== existing.status) {
    void auditLog({
      action: AUDIT_ACTIONS.CONVERSA_STATUS,
      entity: "Conversation",
      entityId: id,
      detail: `status ${existing.status} -> ${data.status}`,
      session,
      req,
      metadata: { antes: existing.status, depois: data.status },
    });
  }
  if (data.sectorId !== undefined && data.sectorId !== existing.sectorId) {
    void auditLog({
      action: AUDIT_ACTIONS.CONVERSA_SETOR,
      entity: "Conversation",
      entityId: id,
      detail: `setor ${existing.sectorId ?? "-"} -> ${data.sectorId ?? "-"}`,
      session,
      req,
      metadata: { antes: existing.sectorId, depois: data.sectorId },
    });
  }
  if (
    data.assignedUserId !== undefined &&
    data.assignedUserId !== existing.assignedUserId
  ) {
    void auditLog({
      action: AUDIT_ACTIONS.CONVERSA_ATRIBUICAO,
      entity: "Conversation",
      entityId: id,
      detail: `atendente ${existing.assignedUserId ?? "-"} -> ${data.assignedUserId ?? "-"}`,
      session,
      req,
      metadata: { antes: existing.assignedUserId, depois: data.assignedUserId },
    });
  }
  return NextResponse.json(toConversationDTO(updated));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores excluem conversas." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      sectorId: true,
      status: true,
      contact: { select: { name: true, phone: true } },
    },
  });
  if (!existing) return NextResponse.json({ error: "Conversa inexistente." }, { status: 404 });

  const scope = await getSectorScope(session);
  if (!canViewConversation(scope, existing.sectorId)) {
    return NextResponse.json({ error: "Sem permissao para esta conversa." }, { status: 403 });
  }

  await prisma.conversation.delete({ where: { id } });

  emitRealtime({
    type: "conversation:update",
    conversationId: id,
    sectorId: existing.sectorId,
  });

  void auditLog({
    action: AUDIT_ACTIONS.CONVERSA_EXCLUIDA,
    entity: "Conversation",
    entityId: id,
    detail: `conversa excluida: ${existing.contact.name ?? existing.contact.phone} (${existing.status})`,
    session,
    req,
    metadata: { status: existing.status, sectorId: existing.sectorId },
  });

  return NextResponse.json({ ok: true });
}
