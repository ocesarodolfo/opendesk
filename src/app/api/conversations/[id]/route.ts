import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { toConversationDTO } from "@/lib/dto";
import { emitRealtime } from "@/lib/realtime";
import { canChangeSector, canViewConversation, getSectorScope } from "@/lib/scope";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      contact: true,
      whatsappNumber: true,
      sector: true,
      assignedUser: { select: { name: true } },
    },
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

  return NextResponse.json({
    conversation: toConversationDTO(conversation),
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      content: m.content,
      status: m.status,
      mediaUrl: m.mediaUrl,
      mediaType: m.mediaType,
      fileName: m.fileName,
      createdAt: m.createdAt.toISOString(),
    })),
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
    select: { sectorId: true },
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
    },
    include: {
      contact: true,
      whatsappNumber: true,
      sector: true,
      assignedUser: { select: { name: true } },
    },
  });

  emitRealtime({
    type: "conversation:update",
    conversationId: id,
    sectorId: updated.sectorId,
    status: updated.status,
  });
  return NextResponse.json(toConversationDTO(updated));
}
