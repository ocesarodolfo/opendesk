import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { waManager } from "@/lib/whatsapp/manager";
import { emitRealtime } from "@/lib/realtime";
import { isUploadAllowed, MAX_UPLOAD_BYTES, saveMediaFile } from "@/lib/media";
import { canViewConversation, getSectorScope } from "@/lib/scope";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

// Envio de midia pelo atendente (multipart/form-data: file + caption)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Envio invalido (esperado multipart/form-data)." }, { status: 400 });
  }

  const file = form.get("file");
  const caption = typeof form.get("caption") === "string" ? (form.get("caption") as string).trim().slice(0, 1024) : "";

  if (!(file instanceof globalThis.File)) {
    return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Arquivo vazio." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Arquivo maior que o limite de 25 MB." }, { status: 413 });
  }
  const mime = file.type || "application/octet-stream";
  if (!isUploadAllowed(mime)) {
    return NextResponse.json({ error: `Tipo de arquivo nao permitido (${mime}).` }, { status: 415 });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { contact: true },
  });
  if (!conversation) return NextResponse.json({ error: "Conversa inexistente." }, { status: 404 });
  if (conversation.status === "CLOSED") {
    return NextResponse.json({ error: "Conversa encerrada." }, { status: 409 });
  }
  const scope = await getSectorScope(session);
  if (!canViewConversation(scope, conversation.sectorId)) {
    return NextResponse.json({ error: "Sem permissao para esta conversa." }, { status: 403 });
  }

  // grava arquivo ANTES do envio (a bolha do inbox precisa dele)
  const buffer = Buffer.from(await file.arrayBuffer());
  let mediaUrl: string;
  try {
    mediaUrl = await saveMediaFile(buffer, mime);
  } catch (error) {
    console.error("[media] falha ao gravar arquivo:", error);
    return NextResponse.json({ error: "Falha ao gravar a midia no servidor." }, { status: 500 });
  }

  const message = await prisma.message.create({
    data: {
      conversationId: id,
      direction: "OUTGOING",
      content: caption,
      mediaUrl,
      mediaType: mime,
      fileName: file.name || null,
      status: "SENT",
    },
  });

  try {
    const { externalId } = await waManager.sendMedia(
      conversation.whatsappNumberId,
      conversation.contact.phone,
      buffer,
      mime,
      caption,
      file.name,
      conversation.contact.jid
    );
    await prisma.message.update({ where: { id: message.id }, data: { externalId } });
  } catch (error) {
    // envio falhou: marca como FAILED e avisa (o arquivo fica, registro da tentativa)
    await prisma.message.update({
      where: { id: message.id },
      data: { status: "FAILED" },
    });
    console.error("[media] falha no envio:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao enviar a midia." },
      { status: 502 }
    );
  }

  emitRealtime({
    type: "message:new",
    conversationId: id,
    message: { ...message, externalId: null, createdAt: message.createdAt, conversationStatus: conversation.status },
  });

  void auditLog({
    action: AUDIT_ACTIONS.MIDIA_ENVIADA,
    entity: "Conversation",
    entityId: id,
    detail: `arquivo ${message.fileName ?? mediaUrl} (${mime})${caption ? `: ${caption.slice(0, 60)}` : ""}`,
    session,
    req,
  });

  return NextResponse.json({
    message: {
      id: message.id,
      direction: message.direction,
      content: message.content,
      status: "SENT",
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
      fileName: message.fileName,
      createdAt: message.createdAt.toISOString(),
    },
  });
}
