import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { toConversationDTO } from "@/lib/dto";
import { conversationVisibilityFilter, getSectorScope } from "@/lib/scope";
import { waManager } from "@/lib/whatsapp/manager";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  const scope = await getSectorScope(session);

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const q = searchParams.get("q")?.trim() || "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 60) || 60, 100);

  const conversations = await prisma.conversation.findMany({
    where: {
      // escopo por setor (F3): ADMIN tudo; agente, seus setores + sem-setor
      ...conversationVisibilityFilter(scope),
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { contact: { name: { contains: q } } },
              { contact: { pushName: { contains: q } } },
              { contact: { phone: { contains: q } } },
            ],
          }
        : {}),
    },
    include: {
      contact: { include: { tags: { include: { tag: true } } } },
      whatsappNumber: true,
      sector: true,
      assignedUser: { select: { name: true } },
      // última mensagem p/ o preview da lista (lastMessage no DTO)
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          content: true,
          mediaType: true,
          fileName: true,
          direction: true,
          senderName: true,
        },
      },
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
  });

  // badges de nao lidas: 1 query agrupada (so INCOMING nunca vistas por
  // atendente, em conversas abertas/pendentes listadas aqui)
  const unreadGroups = await prisma.message.groupBy({
    by: ["conversationId"],
    where: {
      direction: "INCOMING",
      viewed: false,
      conversationId: { in: conversations.map((c) => c.id) },
      conversation: { status: { not: "CLOSED" } },
    },
    _count: { id: true },
  });
  const unread = new Map(unreadGroups.map((g) => [g.conversationId, g._count.id]));

  const RAW_MENTION_RE = /(?<![\w.+-])@\d{10,20}(?!\d)/;
  const resolved = await Promise.all(
    conversations.map(async (c) => {
      const first = c.messages?.[0];
      if (c.contact.isGroup && first?.content && RAW_MENTION_RE.test(first.content)) {
        const groupJid =
          c.contact.jid ?? `${c.contact.phone.replace(/\D/g, "")}@g.us`;
        const [patched] = await waManager.resolveStoredGroupMentions(
          c.whatsappNumberId,
          groupJid,
          c.id,
          [{ content: first.content }],
          c.whatsappNumber.phone
        );
        return {
          ...c,
          messages: [{ ...first, content: patched.content }],
        };
      }
      return c;
    })
  );

  return NextResponse.json(
    resolved.map((c) => {
      const dto = toConversationDTO(c);
      return { ...dto, unreadCount: unread.get(c.id) ?? 0 };
    })
  );
}
