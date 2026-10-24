import "server-only";
import { prisma } from "@/lib/prisma";
import type { Conversation, Contact, Sector, WhatsAppNumber } from "@prisma/client";

export type ConversationDTO = {
  id: string;
  status: string;
  lastMessageAt: string;
  lastMessage: string;
  contactName: string | null;
  contactPhone: string;
  contactId: string;
  contactIsGroup: boolean;
  numberLabel: string;
  sectorId: string | null;
  sectorName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  contactTags: { id: string; name: string; color: string }[];
};

type TagLite = { tag: { id: string; name: string; color: string } };

// recorte leve da última mensagem (linha da lista de conversas)
type LastMsgLite = {
  content: string;
  mediaType: string | null;
  fileName: string | null;
};

type ConversationFull = Conversation & {
  contact: Contact & { tags: TagLite[] };
  whatsappNumber: WhatsAppNumber;
  sector: Sector | null;
  assignedUser: { name: string } | null;
  // opcional: no GET da lista vem 1 mensagem (a última, orderBy desc);
  // no GET/PATCH de detalhe nao vem e o preview fica vazio
  messages?: LastMsgLite[];
};

/**
 * Preview da última mensagem p/ a lista de conversas: midia sem legenda
 * nao pode virar "(sem texto)" — descreve o tipo como o WhatsApp faz.
 */
function lastMessagePreview(m: LastMsgLite | undefined): string {
  if (!m) return "";
  if (m.content) return m.content;
  const t = m.mediaType ?? "";
  if (t === "image/webp" || t === "video/webp") return "📌 Figurinha";
  if (t.startsWith("image/")) return "📷 Foto";
  if (t.startsWith("video/")) return "🎥 Vídeo";
  if (t.startsWith("audio/")) return "🎵 Áudio";
  if (t) return `📄 ${m.fileName || "Documento"}`;
  return "";
}

export function toConversationDTO(c: ConversationFull): ConversationDTO {
  return {
    id: c.id,
    status: c.status,
    lastMessageAt: c.lastMessageAt.toISOString(),
    lastMessage: lastMessagePreview(c.messages?.[0]),
    contactName: c.contact.name ?? c.contact.pushName ?? null,
    contactPhone: c.contact.phone,
    contactId: c.contact.id,
    contactIsGroup: c.contact.isGroup,
    numberLabel: c.whatsappNumber.label,
    sectorId: c.sectorId,
    sectorName: c.sector?.name ?? null,
    assignedUserId: c.assignedUserId,
    assignedUserName: c.assignedUser?.name ?? null,
    contactTags: c.contact.tags.map((t) => ({
      id: t.tag.id,
      name: t.tag.name,
      color: t.tag.color,
    })),
  };
}
