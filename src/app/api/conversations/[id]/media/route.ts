import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { waManager, buildWireMentionText, type OutgoingMentionInput } from "@/lib/whatsapp/manager";
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

  let validMentions: OutgoingMentionInput[] = [];
  const rawMentions = form.get("mentions");
  if (typeof rawMentions === "string" && rawMentions.trim()) {
    try {
      const parsed = JSON.parse(rawMentions) as unknown;
      if (Array.isArray(parsed)) {
        validMentions = parsed.filter(
          (m): m is OutgoingMentionInput =>
            Boolean(
              m &&
                typeof m === "object" &&
                typeof (m as OutgoingMentionInput).jid === "string" &&
                typeof (m as OutgoingMentionInput).displayName === "string"
            )
        );
      }
    } catch {
      /* ignora mentions malformados */
    }
  }

  // prefixo do atendente em LINHA PROPRIA (legenda desce p/ 2a linha);
  // se a legenda ficar vazia, sai o prefixo sozinho assim mesmo
  const prefix = conversation.whatsappNumber.prefixAgent ? `[${session.name}]\n` : "";
  const fullCaption = caption ? `${prefix}${caption}` : conversation.whatsappNumber.prefixAgent ? prefix.trim() : "";
  const { wireText, mentionedJids } =
    conversation.contact.isGroup && caption && validMentions.length > 0
      ? buildWireMentionText(caption, validMentions)
      : { wireText: caption, mentionedJids: [] };
  const wireCaption = wireText ? `${prefix}${wireText}` : fullCaption;

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
      content: fullCaption,
      mediaUrl,
      mediaType: mime,
      fileName: file.name || null,
      status: "SENT",
      groupKey:
        typeof form.get("groupKey") === "string"
          ? (form.get("groupKey") as string).slice(0, 64) || null
          : null,
    },
  });

  try {
    const { externalId } = await waManager.sendMedia(
      conversation.whatsappNumberId,
      conversation.contact.phone,
      buffer,
      mime,
      wireCaption,
      file.name,
      conversation.contact.jid,
      mentionedJids.length > 0 ? mentionedJids : undefined
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
