import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canViewConversation, getSectorScope } from "@/lib/scope";
import { waManager } from "@/lib/whatsapp/manager";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { contact: true, whatsappNumber: true },
  });
  if (!conversation) return NextResponse.json({ error: "Conversa inexistente." }, { status: 404 });

  const scope = await getSectorScope(session);
  if (!canViewConversation(scope, conversation.sectorId)) {
    return NextResponse.json({ error: "Sem permissao para esta conversa." }, { status: 403 });
  }

  if (!conversation.contact.isGroup) {
    return NextResponse.json({ error: "Esta conversa nao e um grupo." }, { status: 400 });
  }

  const groupJid =
    conversation.contact.jid ?? `${conversation.contact.phone.replace(/\D/g, "")}@g.us`;
  const force = req.nextUrl.searchParams.get("refresh") === "1";

  const info = await waManager.getGroupMembers(
    conversation.whatsappNumberId,
    groupJid,
    conversation.id,
    { force, selfPhoneFallback: conversation.whatsappNumber.phone }
  );

  return NextResponse.json(info);
}
