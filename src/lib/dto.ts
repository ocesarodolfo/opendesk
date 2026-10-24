import "server-only";
import { prisma } from "@/lib/prisma";
import type { Conversation, Contact, Sector, WhatsAppNumber } from "@prisma/client";

export type ConversationDTO = {
  id: string;
  status: string;
  lastMessageAt: string;
  contactName: string | null;
  contactPhone: string;
  numberLabel: string;
  sectorName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
};

type ConversationFull = Conversation & {
  contact: Contact;
  whatsappNumber: WhatsAppNumber;
  sector: Sector | null;
  assignedUser: { name: string } | null;
};

export function toConversationDTO(c: ConversationFull): ConversationDTO {
  return {
    id: c.id,
    status: c.status,
    lastMessageAt: c.lastMessageAt.toISOString(),
    contactName: c.contact.name ?? c.contact.pushName ?? null,
    contactPhone: c.contact.phone,
    numberLabel: c.whatsappNumber.label,
    sectorName: c.sector?.name ?? null,
    assignedUserId: c.assignedUserId,
    assignedUserName: c.assignedUser?.name ?? null,
  };
}
