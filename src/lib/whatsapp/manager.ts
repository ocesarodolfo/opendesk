import "server-only";
import path from "node:path";
import { rm } from "node:fs/promises";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  normalizeMessageContent,
  Browsers,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { prisma } from "@/lib/prisma";
import { emitRealtime } from "@/lib/realtime";
import { saveMediaFile } from "@/lib/media";
import { sendIncomingMessagePush } from "@/lib/push";

const logger = pino({ level: "silent" });

export type NumberStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED";

type IncomingMessage = {
  key: {
    remoteJid?: string | null;
    remoteJidAlt?: string | null;
    fromMe?: boolean;
    id?: string | null;
    // em grupos (@g.us): jid do participante que enviou a mensagem
    participant?: string | null;
    // numero real (p/lid) vindo da wire do WhatsApp (nova era LID)
    senderPn?: string | null;
    participantPn?: string | null;
  };
  message?:
    | {
        conversation?: string;
        extendedTextMessage?: { text?: string; contextInfo?: unknown };
        imageMessage?: { mimetype?: string; caption?: string; contextInfo?: unknown };
        videoMessage?: { mimetype?: string; caption?: string; contextInfo?: unknown };
        audioMessage?: { mimetype?: string; contextInfo?: unknown };
        documentMessage?: { mimetype?: string; caption?: string; fileName?: string; contextInfo?: unknown };
        // reacoes chegam como protocolMessage (type 3) com a chave da message original
        protocolMessage?: {
          type?: number;
          key?: { remoteJid?: string | null; id?: string | null; participant?: string | null };
          text?: string;
          timestampMs?: string | number | { toNumber?: () => number };
        };
      }
    | null;
  messageTimestamp?: unknown;
  pushName?: string | null;
};

// mensagem citada (reply do WhatsApp) reduzida para exibicao
type QuotedInfo = {
  snippet: string;
  // digitos do autor da mensagem citada (PN quando o WhatsApp informa;
  // senao LID). Pode nao ser formatavel como telefone — exidade no UI
  sender: string | null;
  // digitos normalizados do jid do autor (p/ casar com mensagens anteriores
  // da mesma conversa e resolver o nome de quem falou)
  senderJidDigits: string | null;
  // jids mencionados dentro da propria mensagem citada
  quotedMentionedJids: string[];
};

type IncomingMedia = { mime: string; caption: string; fileName: string };

export type GroupMemberDTO = {
  jid: string;
  phoneJid: string | null;
  lid: string | null;
  phone: string | null;
  name: string;
  role: "superadmin" | "admin" | "member";
  isSelf: boolean;
};

export type GroupInfoDTO = {
  subject: string | null;
  description: string | null;
  size: number;
  addressingMode: "lid" | "pn" | null;
  connected: boolean;
  fallbackFromHistory: boolean;
  members: GroupMemberDTO[];
};

export type OutgoingMentionInput = {
  jid: string;
  displayName: string;
};

type GroupParticipantLite = {
  id: string;
  jid?: string;
  lid?: string;
  admin?: "admin" | "superadmin" | null;
  name?: string;
  notify?: string;
  verifiedName?: string;
};

type GroupMetaLite = {
  id: string;
  addressingMode?: "lid" | "pn";
  subject?: string;
  desc?: string;
  owner?: string;
  ownerJid?: string;
  size?: number;
  participants: GroupParticipantLite[];
};

type CachedWaContact = {
  name?: string;
  notify?: string;
  verifiedName?: string;
  jid?: string;
  lid?: string;
};

const GROUP_META_TTL_MS = 5 * 60 * 1000;
const RAW_MENTION_TEST_RE = /(?<![\w.+-])@\d{10,20}(?!\d)/;
const RAW_MENTION_FIND_RE = /(?<![\w.+-])@(\d{10,20})(?!\d)/g;

type ManagedSession = {
  socket: ReturnType<typeof makeWASocket>;
  status: NumberStatus;
  qr: string | null;
  // identidade do PROPRIA numero da sessao (para descartar sync de
  // mensagens enviadas pelo celular, que chegam com remoteJid = nos mesmos)
  selfPnDigits?: string | null;
  selfLidDigits?: string | null;
  groupMetaCache: Map<string, { meta: GroupMetaLite; fetchedAt: number }>;
  contactCache: Map<string, CachedWaContact>;
  lidToPn: Map<string, string>;
  pnToLid: Map<string, string>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  stopping?: boolean;
};

// Mantem as sessoes fora do ciclo de hot-reload em desenvolvimento
const globalForWa = globalThis as unknown as {
  __wa_sessions?: Map<string, ManagedSession>;
};

const sessions: Map<string, ManagedSession> =
  globalForWa.__wa_sessions ?? new Map();
globalForWa.__wa_sessions = sessions;

export function sessionsDir(): string {
  return path.resolve(process.cwd(), process.env.SESSIONS_DIR ?? "./sessions");
}

function sessionPath(numberId: string): string {
  return path.join(sessionsDir(), numberId);
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** jid sem variantes de device/usuario: "55279...:25@s.whatsapp.net" -> "55279...@s.whatsapp.net" */
function normalizeJid(jid: string): string | null {
  const [user = "", server = ""] = jid.split("@");
  if (!user || !server) return null;
  return `${user.split(":")[0]}@${server}`;
}

function jidDigits(jid?: string | null): string {
  if (!jid) return "";
  return digitsOnly(jid.split("@")[0].split(":")[0]);
}

function isPhoneJid(jid?: string | null): boolean {
  return typeof jid === "string" && jid.endsWith("@s.whatsapp.net");
}

function isLidJid(jid?: string | null): boolean {
  return typeof jid === "string" && jid.endsWith("@lid");
}

function formatPhoneDisplay(d: string): string {
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d}`;
}

function isHumanName(v?: string | null): boolean {
  const trimmed = v?.trim() ?? "";
  if (!trimmed) return false;
  return !/^\+?\d[\d\s()-]*$/.test(trimmed);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function recordContactInfo(
  session: ManagedSession | undefined,
  info: {
    id?: string | null;
    jid?: string | null;
    lid?: string | null;
    name?: string | null;
    notify?: string | null;
    verifiedName?: string | null;
  }
): void {
  if (!session) return;
  const pnJid = isPhoneJid(info.jid)
    ? normalizeJid(info.jid!)
    : isPhoneJid(info.id)
      ? normalizeJid(info.id!)
      : null;
  const lidJid = isLidJid(info.lid)
    ? normalizeJid(info.lid!)
    : isLidJid(info.id)
      ? normalizeJid(info.id!)
      : null;

  const pnDigits = jidDigits(pnJid);
  const lidDigits = jidDigits(lidJid);

  if (lidDigits && pnDigits) {
    session.lidToPn.set(lidDigits, pnDigits);
    session.pnToLid.set(pnDigits, lidDigits);
  }

  const keys = [pnDigits, lidDigits].filter(Boolean);
  if (keys.length === 0) return;

  for (const key of keys) {
    const prev = session.contactCache.get(key) ?? {};
    const next: CachedWaContact = {
      name: isHumanName(info.name) ? info.name!.trim() : prev.name,
      notify: isHumanName(info.notify) ? info.notify!.trim() : prev.notify,
      verifiedName: isHumanName(info.verifiedName) ? info.verifiedName!.trim() : prev.verifiedName,
      jid: pnJid ?? prev.jid,
      lid: lidJid ?? prev.lid,
    };
    session.contactCache.set(key, next);
  }
}

/**
 * Converte mencoes "@Nome" digitadas pelo atendente no formato wire do WhatsApp
 * ("@<digitos_do_jid>") e devolve a lista de JIDs para `contextInfo.mentionedJid`.
 */
export function buildWireMentionText(
  displayText: string,
  mentions: OutgoingMentionInput[]
): { wireText: string; mentionedJids: string[] } {
  if (!displayText || !mentions?.length) {
    return { wireText: displayText, mentionedJids: [] };
  }

  const deduped = new Map<string, { jid: string; displayName: string; digits: string }>();
  for (const m of mentions) {
    if (!m || typeof m.jid !== "string" || typeof m.displayName !== "string") continue;
    const normJid = normalizeJid(m.jid) ?? m.jid.trim();
    const displayName = m.displayName.trim();
    const digits = jidDigits(normJid);
    if (!normJid.includes("@") || !displayName || !digits) continue;
    const key = `${normJid.toLowerCase()}::${displayName.toLowerCase()}`;
    if (!deduped.has(key)) {
      deduped.set(key, { jid: normJid, displayName, digits });
    }
  }

  const sorted = [...deduped.values()].sort(
    (a, b) => b.displayName.length - a.displayName.length
  );

  let wireText = displayText;
  const mentionedSet = new Set<string>();

  for (const item of sorted) {
    const re = new RegExp(
      `(?<![\\w.+-])@${escapeRegex(item.displayName)}(?![\\wÀ-ÿ])`,
      "gi"
    );
    let matched = false;
    wireText = wireText.replace(re, () => {
      matched = true;
      return `@${item.digits}`;
    });
    if (matched) {
      mentionedSet.add(item.jid);
    }
  }

  return { wireText, mentionedJids: [...mentionedSet] };
}

/** messageTimestamp (segundos ou bigint) -> ms */
function messageTimestampMs(msg: { messageTimestamp?: unknown }): number {
  const ts = msg.messageTimestamp as number | bigint | { toNumber?: () => number } | undefined;
  if (typeof ts === "number" && ts > 0) return ts * 1000;
  if (typeof ts === "bigint") return Number(ts) * 1000;
  if (typeof ts === "object" && ts !== null && typeof (ts as { toNumber?: unknown }).toNumber === "function") {
    return (ts as { toNumber: () => number }).toNumber() * 1000;
  }
  return Date.now();
}

/**
 * Idade maxima para importar mensagens. Pelo pareamento chega o historico
 * inteiro da conta (meses de conversa) via sync; sem esse corte o inbox
 * de "Pendentes" viria inundado de mensagens antigas.
 */
const MAX_BACKFILL_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Identidade do PROPRIO numero da sessao, a partir de creds.me:
 * `me.id`/`me.jid` = telefone real (@s.whatsapp.net) e `me.lid` = LID.
 * Necessário para NAO criar conversa consigo mesmo: quando o atendente manda
 * mensagem pelo celular, o sync offline repassa a copia com remoteJid = o
 * LID do proprio numero (stanza `category=peer` sem `recipient`). */
function syncSelfIdentity(session: ManagedSession): void {
  const creds = (
    session.socket as unknown as {
      authState?: { creds?: { me?: { id?: string; jid?: string; lid?: string } | null } };
    }
  ).authState?.creds;
  const me = creds?.me ?? null;
  const pnJid = me?.jid
    ? me.jid
    : me?.id?.endsWith("@s.whatsapp.net")
      ? me.id
      : null;
  session.selfPnDigits = pnJid ? digitsOnly(pnJid.split("@")[0].split(":")[0]) : null;
  // me.lid pode vir com o device junto ("196...:25@lid") — fatia o device,
  // senao o filtro de self-chat nao casa com o remoteJid (sem device)
  const lidJid = me?.lid ?? (me?.id?.endsWith("@lid") ? me.id : null);
  session.selfLidDigits = lidJid ? digitsOnly(lidJid.split("@")[0].split(":")[0]) : null;
}

/**
 * Re-estabelece as sessoes que estavam ativas antes de um restart do
 * processo (o socket do WhatsApp vive na memoria do Node).
 * Chamada no boot (src/instrumentation.ts).
 */
async function resumeAll(): Promise<void> {
  const numbers = await prisma.whatsAppNumber.findMany({
    where: { active: true, status: { in: ["CONNECTING", "CONNECTED"] } },
  });
  for (const number of numbers) {
    void waManager
      .connect(number.id)
      .catch((e) => console.error(`[whatsapp] retomada de ${number.id} falhou:`, e));
  }
}

export function scheduleResume(): void {
  void Promise.resolve().then(resumeAll).catch((e) => console.error("[whatsapp] resume:", e));
}

function unwrapMessageContent(raw: unknown): NonNullable<IncomingMessage["message"]> | null {
  if (!raw || typeof raw !== "object") return null;
  const normalized = normalizeMessageContent(raw as never) as IncomingMessage["message"] | undefined;
  return (normalized ?? (raw as IncomingMessage["message"])) ?? null;
}

function unwrapMessage(msg: IncomingMessage): NonNullable<IncomingMessage["message"]> | null {
  return unwrapMessageContent(msg.message);
}

function extractText(msg: IncomingMessage): string {
  const m = unwrapMessage(msg);
  if (!m) return "";
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    ""
  );
}

function extractMentionedJidsFromContent(content: unknown): string[] {
  const m = unwrapMessageContent(content);
  if (!m) return [];
  const cis = [
    m.extendedTextMessage?.contextInfo,
    m.imageMessage?.contextInfo,
    m.videoMessage?.contextInfo,
    m.documentMessage?.contextInfo,
    m.audioMessage?.contextInfo,
  ];
  const out = new Set<string>();
  for (const ci of cis) {
    const list = (ci as { mentionedJid?: unknown } | null | undefined)?.mentionedJid;
    if (Array.isArray(list)) {
      for (const jid of list) {
        if (typeof jid === "string" && jid.includes("@")) out.add(jid);
      }
    }
  }
  return [...out];
}

function extractMentionedJids(msg: IncomingMessage): string[] {
  return extractMentionedJidsFromContent(msg.message);
}

type ParticipantDirectoryEntry = {
  mentionLabel: string;
  memberName: string;
  phone: string | null;
  phoneJid: string | null;
  lid: string | null;
  primaryJid: string;
  role: "superadmin" | "admin" | "member";
  isSelf: boolean;
};

type GroupParticipantDirectory = {
  meta: GroupMetaLite | null;
  connected: boolean;
  byDigits: Map<string, ParticipantDirectoryEntry>;
  members: GroupMemberDTO[];
};

async function getGroupMetadata(
  numberId: string,
  groupJid: string,
  opts?: { force?: boolean }
): Promise<GroupMetaLite | null> {
  const session = sessions.get(numberId);
  if (!session || session.status !== "CONNECTED") return null;

  const cached = session.groupMetaCache.get(groupJid);
  if (!opts?.force && cached && Date.now() - cached.fetchedAt < GROUP_META_TTL_MS) {
    return cached.meta;
  }

  try {
    const raw = (await session.socket.groupMetadata(groupJid)) as unknown as GroupMetaLite;
    if (!raw) return cached?.meta ?? null;

    for (const p of raw.participants ?? []) {
      recordContactInfo(session, {
        id: p.id,
        jid: p.jid,
        lid: p.lid,
        name: p.name,
        notify: p.notify,
        verifiedName: p.verifiedName,
      });
    }

    session.groupMetaCache.set(groupJid, { meta: raw, fetchedAt: Date.now() });
    return raw;
  } catch {
    return cached?.meta ?? null;
  }
}

async function getSelfDigits(
  numberId: string,
  selfPhoneFallback?: string | null
): Promise<{ selfPnDigits: string | null; selfLidDigits: string | null }> {
  const session = sessions.get(numberId);
  let selfPnDigits = session?.selfPnDigits ?? null;
  const selfLidDigits = session?.selfLidDigits ?? null;

  if (!selfPnDigits) {
    const rawFallback = selfPhoneFallback ? digitsOnly(selfPhoneFallback) : "";
    if (rawFallback) {
      selfPnDigits = rawFallback;
    } else {
      const num = await prisma.whatsAppNumber
        .findUnique({ where: { id: numberId }, select: { phone: true } })
        .catch(() => null);
      selfPnDigits = num?.phone ? digitsOnly(num.phone) : null;
    }
  }
  return { selfPnDigits, selfLidDigits };
}

function cachedContactLabel(session: ManagedSession | undefined, digitsList: string[]): string | null {
  if (!session) return null;
  for (const d of digitsList) {
    const c = session.contactCache.get(d);
    const label = c?.name || c?.verifiedName || c?.notify;
    if (isHumanName(label)) return label!.trim();
  }
  return null;
}

function pickRole(
  p: GroupParticipantLite,
  meta: GroupMetaLite
): "superadmin" | "admin" | "member" {
  if (p.admin === "superadmin") return "superadmin";
  const ownerDigits = jidDigits(meta.ownerJid) || jidDigits(meta.owner);
  const pDigits = [jidDigits(p.jid), jidDigits(p.lid), jidDigits(p.id)].filter(Boolean);
  if (ownerDigits && pDigits.includes(ownerDigits)) return "superadmin";
  if (p.admin === "admin") return "admin";
  return "member";
}

function sortMembers(members: GroupMemberDTO[]): GroupMemberDTO[] {
  const roleRank = { superadmin: 0, admin: 1, member: 2 };
  return [...members].sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    if (roleRank[a.role] !== roleRank[b.role]) return roleRank[a.role] - roleRank[b.role];
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });
}

async function buildGroupParticipantDirectory(
  numberId: string,
  groupJid: string,
  conversationId: string | null,
  opts?: { force?: boolean; groupMeta?: GroupMetaLite | null; selfPhoneFallback?: string | null }
): Promise<GroupParticipantDirectory> {
  const session = sessions.get(numberId);
  const connected = Boolean(session && session.status === "CONNECTED");
  const meta =
    opts?.groupMeta !== undefined
      ? opts.groupMeta
      : await getGroupMetadata(numberId, groupJid, { force: opts?.force });
  const { selfPnDigits, selfLidDigits } = await getSelfDigits(numberId, opts?.selfPhoneFallback);

  const byDigits = new Map<string, ParticipantDirectoryEntry>();
  const recentSenderNames = new Map<string, string>();

  if (conversationId) {
    const msgs = await prisma.message.findMany({
      where: { conversationId, senderJid: { not: null }, senderName: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { senderJid: true, senderName: true },
    });
    for (const m of msgs) {
      const d = jidDigits(m.senderJid);
      if (d && !recentSenderNames.has(d) && isHumanName(m.senderName)) {
        recentSenderNames.set(d, m.senderName!.trim());
      }
    }
  }

  if (meta && (meta.participants?.length ?? 0) > 0) {
    const allJids = new Set<string>();
    const allPhones = new Set<string>();

    for (const p of meta.participants) {
      const idNorm = normalizeJid(p.id) ?? p.id;
      const pJid = isPhoneJid(p.jid) ? normalizeJid(p.jid!) : isPhoneJid(idNorm) ? idNorm : null;
      const pLid = isLidJid(p.lid) ? normalizeJid(p.lid!) : isLidJid(idNorm) ? idNorm : null;
      const lidD = jidDigits(pLid);
      const pnD = jidDigits(pJid) || (lidD ? session?.lidToPn.get(lidD) ?? "" : "");

      if (pJid) allJids.add(pJid);
      if (pLid) allJids.add(pLid);
      if (pnD) {
        allPhones.add(pnD);
        allJids.add(`${pnD}@s.whatsapp.net`);
      }
      if (lidD) allPhones.add(lidD);
    }

    const dbContacts =
      allJids.size > 0 || allPhones.size > 0
        ? await prisma.contact.findMany({
            where: {
              isGroup: false,
              OR: [
                ...(allJids.size > 0 ? [{ jid: { in: [...allJids] } }] : []),
                ...(allPhones.size > 0 ? [{ phone: { in: [...allPhones] } }] : []),
              ],
            },
            select: { jid: true, phone: true, name: true, pushName: true },
          })
        : [];

    const dbByJid = new Map<string, (typeof dbContacts)[number]>();
    const dbByPhone = new Map<string, (typeof dbContacts)[number]>();
    for (const c of dbContacts) {
      if (c.jid) dbByJid.set(normalizeJid(c.jid) ?? c.jid, c);
      if (c.phone) dbByPhone.set(c.phone, c);
    }

    const members: GroupMemberDTO[] = [];
    const seenPrimary = new Set<string>();

    for (const p of meta.participants) {
      const idNorm = normalizeJid(p.id) ?? p.id;
      const rawLid = isLidJid(p.lid) ? normalizeJid(p.lid!) : isLidJid(idNorm) ? idNorm : null;
      const lidDigits = jidDigits(rawLid);
      const mappedPn = lidDigits ? session?.lidToPn.get(lidDigits) ?? null : null;

      let phoneJid = isPhoneJid(p.jid) ? normalizeJid(p.jid!) : isPhoneJid(idNorm) ? idNorm : null;
      const pnDigits = jidDigits(phoneJid) || mappedPn || null;
      if (!phoneJid && pnDigits) {
        phoneJid = `${pnDigits}@s.whatsapp.net`;
      }
      const mappedLid = !rawLid && pnDigits ? session?.pnToLid.get(pnDigits) ?? null : null;
      const lid = rawLid ?? (mappedLid ? `${mappedLid}@lid` : null);
      const finalLidDigits = jidDigits(lid);

      const primaryJid =
        (meta.addressingMode === "lid" ? lid ?? phoneJid : phoneJid ?? lid) ?? idNorm;
      if (seenPrimary.has(primaryJid)) continue;
      seenPrimary.add(primaryJid);

      const digitsKeys = [...new Set([pnDigits, finalLidDigits, jidDigits(idNorm)].filter(Boolean) as string[])];
      const isSelf = Boolean(
        (selfPnDigits && digitsKeys.includes(selfPnDigits)) ||
          (selfLidDigits && digitsKeys.includes(selfLidDigits))
      );

      const dbHit =
        (phoneJid && dbByJid.get(phoneJid)) ||
        (lid && dbByJid.get(lid)) ||
        (pnDigits && dbByPhone.get(pnDigits)) ||
        (finalLidDigits && dbByPhone.get(finalLidDigits)) ||
        null;

      const dbName =
        (isHumanName(dbHit?.name) ? dbHit!.name!.trim() : null) ||
        (isHumanName(dbHit?.pushName) ? dbHit!.pushName!.trim() : null);

      const cacheName = cachedContactLabel(session, digitsKeys);
      const participantName =
        (isHumanName(p.name) ? p.name!.trim() : null) ||
        (isHumanName(p.verifiedName) ? p.verifiedName!.trim() : null) ||
        (isHumanName(p.notify) ? p.notify!.trim() : null);
      const histName = digitsKeys.map((k) => recentSenderNames.get(k)).find(Boolean) ?? null;

      const resolvedHuman = dbName || cacheName || participantName || histName;
      const memberName =
        resolvedHuman ||
        (pnDigits ? formatPhoneDisplay(pnDigits) : null) ||
        (isSelf ? "Você" : digitsKeys[0] || primaryJid);
      const mentionLabel = isSelf ? "Você" : memberName;
      const role = pickRole(p, meta);

      const entry: ParticipantDirectoryEntry = {
        mentionLabel,
        memberName,
        phone: pnDigits,
        phoneJid,
        lid,
        primaryJid,
        role,
        isSelf,
      };
      for (const k of digitsKeys) {
        byDigits.set(k, entry);
      }

      members.push({
        jid: primaryJid,
        phoneJid,
        lid,
        phone: pnDigits,
        name: memberName,
        role,
        isSelf,
      });
    }

    return { meta, connected, byDigits, members: sortMembers(members) };
  }

  // Fallback quando desconectado ou sem groupMetadata: usa participantes vistos no historico
  const historyMembers: GroupMemberDTO[] = [];
  if (conversationId) {
    const historyRows = await prisma.message.findMany({
      where: { conversationId, senderJid: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { senderJid: true, senderName: true },
    });

    const uniqueByDigits = new Map<string, { jid: string; name: string | null }>();
    for (const row of historyRows) {
      if (!row.senderJid) continue;
      const d = jidDigits(row.senderJid);
      if (!d) continue;
      const prev = uniqueByDigits.get(d);
      const candidateName = isHumanName(row.senderName) ? row.senderName!.trim() : null;
      if (!prev) {
        uniqueByDigits.set(d, {
          jid: normalizeJid(row.senderJid) ?? row.senderJid,
          name: candidateName,
        });
      } else if (!prev.name && candidateName) {
        prev.name = candidateName;
      }
    }

    const histJids = [...uniqueByDigits.values()].map((v) => v.jid);
    const histDigits = [...uniqueByDigits.keys()];
    const dbContacts =
      histJids.length > 0
        ? await prisma.contact.findMany({
            where: {
              isGroup: false,
              OR: [{ jid: { in: histJids } }, { phone: { in: histDigits } }],
            },
            select: { jid: true, phone: true, name: true, pushName: true },
          })
        : [];

    for (const [d, info] of uniqueByDigits.entries()) {
      const pnD = isPhoneJid(info.jid) ? d : session?.lidToPn.get(d) ?? null;
      const lid = isLidJid(info.jid) ? info.jid : null;
      const phoneJid = isPhoneJid(info.jid) ? info.jid : pnD ? `${pnD}@s.whatsapp.net` : null;
      const isSelf = Boolean(
        (selfPnDigits && (d === selfPnDigits || pnD === selfPnDigits)) ||
          (selfLidDigits && d === selfLidDigits)
      );
      const dbHit = dbContacts.find((c) => c.jid === info.jid || c.phone === d || (pnD && c.phone === pnD));
      const dbName =
        (isHumanName(dbHit?.name) ? dbHit!.name!.trim() : null) ||
        (isHumanName(dbHit?.pushName) ? dbHit!.pushName!.trim() : null);
      const cacheName = cachedContactLabel(session, pnD ? [d, pnD] : [d]);
      const memberName =
        dbName ||
        cacheName ||
        info.name ||
        (pnD ? formatPhoneDisplay(pnD) : null) ||
        (isSelf ? "Você" : d);
      const mentionLabel = isSelf ? "Você" : memberName;

      const entry: ParticipantDirectoryEntry = {
        mentionLabel,
        memberName,
        phone: pnD,
        phoneJid,
        lid,
        primaryJid: info.jid,
        role: "member",
        isSelf,
      };
      byDigits.set(d, entry);
      if (pnD) byDigits.set(pnD, entry);

      historyMembers.push({
        jid: info.jid,
        phoneJid,
        lid,
        phone: pnD,
        name: memberName,
        role: "member",
        isSelf,
      });
    }
  }

  return { meta: null, connected, byDigits, members: sortMembers(historyMembers) };
}

function replaceMentionTokens(text: string, labels: Map<string, string>): string {
  if (!text || labels.size === 0) return text;
  let resolved = text;
  for (const [digits, label] of labels.entries()) {
    const re = new RegExp(`(?<![\\w.+-])@${digits}(?!\\d)`, "g");
    resolved = resolved.replace(re, () => `@${label}`);
  }
  return resolved;
}

/**
 * Converte mencoes "@176398668947474" (LID ou telefone) no nome do participante/contato
 * (ou "Você" quando for o proprio numero conectado) usando groupMetadata, cache de contatos,
 * banco de contatos e historico do grupo.
 */
async function resolveTextMentions(
  numberId: string,
  text: string,
  opts?: {
    mentionedJids?: string[];
    groupJid?: string | null;
    conversationId?: string | null;
    groupMeta?: GroupMetaLite | null;
    selfPhoneFallback?: string | null;
  }
): Promise<string> {
  if (!text || !text.includes("@")) return text;

  const jids = opts?.mentionedJids ?? [];
  const rawTokens = new Set<string>();
  for (const m of text.matchAll(RAW_MENTION_FIND_RE)) {
    if (m[1]) rawTokens.add(m[1]);
  }
  if (jids.length === 0 && rawTokens.size === 0) return text;

  const session = sessions.get(numberId);
  const { selfPnDigits, selfLidDigits } = await getSelfDigits(numberId, opts?.selfPhoneFallback);

  const directory = opts?.groupJid
    ? await buildGroupParticipantDirectory(numberId, opts.groupJid, opts.conversationId ?? null, {
        groupMeta: opts.groupMeta,
        selfPhoneFallback: opts.selfPhoneFallback,
      })
    : null;

  const targetMap = new Map<string, string | null>(); // digits -> normJid|null
  for (const jid of jids) {
    const d = jidDigits(jid);
    if (d) targetMap.set(d, normalizeJid(jid) ?? jid);
  }
  for (const d of rawTokens) {
    if (!targetMap.has(d)) targetMap.set(d, null);
  }

  const labels = new Map<string, string>();
  const unresolved: { digits: string; normJid: string | null; pnDigits: string | null }[] = [];

  for (const [digits, normJid] of targetMap.entries()) {
    if ((selfLidDigits && digits === selfLidDigits) || (selfPnDigits && digits === selfPnDigits)) {
      labels.set(digits, "Você");
      continue;
    }

    const dirHit = directory?.byDigits.get(digits);
    if (dirHit) {
      labels.set(digits, dirHit.mentionLabel);
      continue;
    }

    const mappedPn =
      (isPhoneJid(normJid) ? digits : null) ??
      session?.lidToPn.get(digits) ??
      null;
    unresolved.push({ digits, normJid, pnDigits: mappedPn });
  }

  if (unresolved.length > 0) {
    const queryJids = new Set<string>();
    const queryPhones = new Set<string>();
    for (const u of unresolved) {
      if (u.normJid) queryJids.add(u.normJid);
      queryPhones.add(u.digits);
      if (u.pnDigits) {
        queryPhones.add(u.pnDigits);
        queryJids.add(`${u.pnDigits}@s.whatsapp.net`);
      }
    }

    const [contacts, fallbackMsgs] = await Promise.all([
      prisma.contact.findMany({
        where: {
          isGroup: false,
          OR: [
            ...(queryJids.size > 0 ? [{ jid: { in: [...queryJids] } }] : []),
            { phone: { in: [...queryPhones] } },
          ],
        },
        select: { jid: true, phone: true, name: true, pushName: true },
      }),
      prisma.message.findMany({
        where: {
          senderName: { not: null },
          OR: [...queryPhones].map((d) => ({ senderJid: { contains: d } })),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { conversationId: true, senderJid: true, senderName: true },
      }),
    ]);

    for (const u of unresolved) {
      const contactHit = contacts.find(
        (c) =>
          (u.normJid && c.jid === u.normJid) ||
          c.phone === u.digits ||
          (u.pnDigits && (c.phone === u.pnDigits || c.jid === `${u.pnDigits}@s.whatsapp.net`))
      );
      const dbLabel =
        (isHumanName(contactHit?.name) ? contactHit!.name!.trim() : null) ||
        (isHumanName(contactHit?.pushName) ? contactHit!.pushName!.trim() : null);
      if (dbLabel) {
        labels.set(u.digits, dbLabel);
        continue;
      }

      const cacheLabel = cachedContactLabel(
        session,
        u.pnDigits ? [u.digits, u.pnDigits] : [u.digits]
      );
      if (cacheLabel) {
        labels.set(u.digits, cacheLabel);
        continue;
      }

      const candidates = fallbackMsgs.filter((m) => {
        const sd = jidDigits(m.senderJid);
        return (sd === u.digits || (u.pnDigits && sd === u.pnDigits)) && isHumanName(m.senderName);
      });
      const sameConvHit = opts?.conversationId
        ? candidates.find((m) => m.conversationId === opts.conversationId)
        : undefined;
      const msgHit = sameConvHit ?? candidates[0];
      if (msgHit?.senderName) {
        labels.set(u.digits, msgHit.senderName.trim());
        continue;
      }

      const pnFromContact =
        contactHit && isPhoneJid(contactHit.jid) ? jidDigits(contactHit.jid) : null;
      const knownPn = u.pnDigits || pnFromContact;
      if (knownPn) {
        labels.set(u.digits, formatPhoneDisplay(knownPn));
      }
    }
  }

  return replaceMentionTokens(text, labels);
}

/** Rotulo curto quando a mensagem citada e midia sem legenda. */
function quotedMediaLabel(m: NonNullable<IncomingMessage["message"]>): string {
  if (m.imageMessage) return "[Imagem]";
  if (m.videoMessage) return "[Video]";
  if (m.audioMessage) return "[Audio]";
  if (m.documentMessage) return m.documentMessage.fileName ? `[Documento: ${m.documentMessage.fileName}]` : "[Documento]";
  return "[Mensagem]";
}

/**
 * Mensagem encaminhada: contextInfo.isForwarded / forwardingScore > 0 em
 * qualquer corpo (o WhatsApp marca com a etiqueta "Encaminhada").
 */
function detectForwarded(msg: IncomingMessage): boolean {
  const m = unwrapMessage(msg);
  if (!m) return false;
  const cis = [
    m.extendedTextMessage?.contextInfo,
    m.imageMessage?.contextInfo,
    m.videoMessage?.contextInfo,
    m.documentMessage?.contextInfo,
    m.audioMessage?.contextInfo,
  ] as unknown[];
  return cis.some((ci) => {
    const c = ci as { isForwarded?: boolean; forwardingScore?: number } | null | undefined;
    return c?.isForwarded === true || (c?.forwardingScore ?? 0) > 0;
  });
}

/**
 * Extrai a mensagem citada (reply) de qualquer tipo que carregue contextInfo.
 * Devolve trecho curto para exibir na bolha + telefone real de quem falou.
 */
function extractQuote(msg: IncomingMessage): QuotedInfo | null {
  const m = unwrapMessage(msg);
  if (!m) return null;
  const ci = (m.extendedTextMessage?.contextInfo ??
    m.imageMessage?.contextInfo ??
    m.videoMessage?.contextInfo ??
    m.documentMessage?.contextInfo ??
    m.audioMessage?.contextInfo) as
    | {
        quotedMessage?: Record<string, unknown>;
        participantPn?: string | null;
        participant?: string | null;
      }
    | null | undefined;
  const quoted = unwrapMessageContent(ci?.quotedMessage);
  if (!quoted) return null;

  const q = quoted as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { caption?: string };
  };
  const snippet =
    q.conversation ??
    q.extendedTextMessage?.text ??
    q.imageMessage?.caption ??
    q.videoMessage?.caption ??
    q.documentMessage?.caption ??
    quotedMediaLabel(q as never);
  const trimmed = snippet.trim().slice(0, 200);
  if (!trimmed) return null;

  // autor da mensagem citada: PN real primeiro (era LID: o participant costuma
  // ser "@lid"); corta o device (":25") antes dos digitos
  const pnJid = ci?.participantPn || "";
  const anyJid = pnJid || ci?.participant || "";
  const senderDigits = anyJid ? digitsOnly(anyJid.split("@")[0].split(":")[0]) : "";
  return {
    snippet: trimmed,
    sender: senderDigits || null,
    senderJidDigits: senderDigits || null,
    quotedMentionedJids: extractMentionedJidsFromContent(quoted),
  };
}

/**
 * Numero real (PN) do remetente, quando o WhatsApp o informa junto do LID.
 * Ordem: remoteJidAlt > participantPn > senderPn (o WhatsApp usa fontes
 * diferentes por rota de entrega).
 */
function resolvePhone(msg: IncomingMessage, jid: string, isGroup: boolean): string {
  if (isGroup) {
    // contato do inbox e o proprio grupo (@g.us continua sem "lid")
    return digitsOnly(jid.split("@")[0]);
  }
  const key = msg.key;
  if (!jid.endsWith("@lid")) {
    return digitsOnly(jid.split("@")[0].split(":")[0]);
  }
  const candidates = [
    key.remoteJidAlt,
    key.participantPn,
    key.senderPn,
  ];
  for (const cand of candidates) {
    if (typeof cand === "string" && cand.endsWith("@s.whatsapp.net")) {
      const digits = digitsOnly(cand.split("@")[0]);
      if (digits) return digits;
    }
  }
  return digitsOnly(jid.split("@")[0]);
}

/**
 * Baixa a midia da mensagem (quando existir). Retorna null se nao houver
 * midia ou se o download falhar (a mensagem segue como texto).
 *
 * Na v6.7 do Baileys o download e um utilitario exportado (nao um metodo
 * do socket) — por isso recebemos apenas a mensagem.
 */
async function downloadMessageMedia(msg: unknown): Promise<Buffer | null> {
  try {
    const out = await downloadMediaMessage(
      msg as Parameters<typeof downloadMediaMessage>[0],
      "buffer",
      {}
    );
    return Buffer.isBuffer(out) ? out : null;
  } catch (error) {
    console.error("[whatsapp] falha ao baixar midia:", error);
    return null;
  }
}

function extractMedia(msg: IncomingMessage): IncomingMedia | null {
  const m = unwrapMessage(msg);
  if (!m) return null;
  if (m.imageMessage?.mimetype) {
    return { mime: m.imageMessage.mimetype, caption: m.imageMessage.caption ?? "", fileName: "" };
  }
  if (m.videoMessage?.mimetype) {
    return { mime: m.videoMessage.mimetype, caption: m.videoMessage.caption ?? "", fileName: "" };
  }
  if (m.audioMessage?.mimetype) {
    return { mime: m.audioMessage.mimetype, caption: "", fileName: "" };
  }
  if (m.documentMessage?.mimetype) {
    return { mime: m.documentMessage.mimetype, caption: m.documentMessage.caption ?? "", fileName: m.documentMessage.fileName ?? "" };
  }
  // stickers/contatos/localizacao: sem tratamento v2.x
  return null;
}

/**
 * Garante o contato do chat. Casamento em ordem:
 * 1) por `jid` do chat (inclui LID) — essencial: as copias das mensagens que
 *    o atendente manda pelo celular chegam com remoteJid = o LID do contato
 *    (e sem o numero). Sem esse match, cada copia criava contato + conversa
 *    duplicada ("conversa consigo mesmo" na lista).
 * 2) por `phone`; e migra contato criado com os digitos do LID para o numero
 *    real assim que o WhatsApp o revela (historico segue no mesmo contato).
 */
async function upsertContact(
  msg: IncomingMessage,
  jid: string,
  phone: string,
  isGroup: boolean,
  groupName: string | null,
  pushName: string | null
) {
  const lidDigits = jid.endsWith("@lid") ? digitsOnly(jid.split("@")[0]) : null;
  const jidKey = normalizeJid(jid) ?? jid;

  // 1) casamento por jid
  let contact = await prisma.contact.findFirst({ where: { jid: jidKey } });

  // 1a) o contato ainda tem telefone placeholder (digitos do LID) e agora
  //     chegou o numero real (attrs de PN): migra o telefone. Se `phone` sao
  //     os proprios digitos do LID, mantem o que ja existe.
  if (contact && !isGroup && lidDigits && phone !== lidDigits && contact.phone === lidDigits) {
    try {
      contact = await prisma.contact.update({ where: { id: contact.id }, data: { phone, jid: jidKey } });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        (error as { code?: string }).code === "P2002"
      ) {
        // outro processo migrou primeiro: segue com o contato ja atualizado
        contact = await prisma.contact.findUnique({ where: { phone } });
      } else {
        throw error;
      }
    }
  }

  if (!contact) {
    contact = await prisma.contact.findUnique({ where: { phone } });
    if (!contact && lidDigits && lidDigits !== phone) {
      const lidContact = await prisma.contact.findUnique({ where: { phone: lidDigits } });
      if (lidContact) {
        try {
          contact = await prisma.contact.update({
            where: { id: lidContact.id },
            data: { phone, updatedAt: new Date(), jid: jidKey },
          });
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            (error as { code?: string }).code === "P2002"
          ) {
            // outro processo migrou primeiro: segue com o contato ja atualizado
            contact = await prisma.contact.findUnique({ where: { phone } });
          } else {
            throw error;
          }
        }
      }
    }
  }

  if (contact) {
    return prisma.contact.update({
      where: { id: contact.id },
      data: {
        updatedAt: new Date(),
        jid: jidKey,
        // grupo renomeado: o nome do inbox acompanha o subject
        ...(isGroup && groupName ? { name: groupName } : {}),
        // pushName so preenche se o contato ainda nao tem (renome manual preservado em `name`)
        ...(isGroup || contact.pushName || !pushName ? {} : { pushName }),
      },
    });
  }
  return prisma.contact.create({
    data: {
      phone,
      isGroup,
      pushName: isGroup ? null : pushName,
      name: groupName,
      jid: jidKey,
    },
  });
}

/**
 * Gerenciador de sessoes WhatsApp (uma sessao por numero da empresa).
 * Fluxo: pareamento por QR -> sessao persistida em disco ->
 * mensagens recebidas -> banco (Prisma) -> UI via SSE (barramento).
 */
export const waManager = {
  getStatus(numberId: string): { status: NumberStatus; qr: string | null; phone: string | null } {
    const session = sessions.get(numberId);
    if (!session) return { status: "DISCONNECTED", qr: null, phone: null };
    const phone = session.socket.user?.id ? digitsOnly(session.socket.user.id.split("@")[0]) : null;
    return { status: session.status, qr: session.qr, phone };
  },

  async connect(numberId: string): Promise<{ status: NumberStatus }> {
    const existing = sessions.get(numberId);
    if (existing && (existing.status === "CONNECTED" || existing.status === "CONNECTING")) {
      return { status: existing.status };
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath(numberId));
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      browser: Browsers.appropriate("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    const session: ManagedSession = {
      socket,
      status: "CONNECTING",
      qr: null,
      groupMetaCache: new Map(),
      contactCache: new Map(),
      lidToPn: new Map(),
      pnToLid: new Map(),
    };
    sessions.set(numberId, session);
    // creds do disco podem ja carregar a identidade propria (sessoes antigas)
    syncSelfIdentity(session);
    await this.setDbStatus(numberId, "CONNECTING");

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("contacts.upsert", (contacts) => {
      for (const c of contacts) recordContactInfo(session, c);
    });

    socket.ev.on("contacts.update", (contacts) => {
      for (const c of contacts) recordContactInfo(session, c);
    });

    socket.ev.on("messaging-history.set", (data) => {
      if (Array.isArray(data?.contacts)) {
        for (const c of data.contacts) recordContactInfo(session, c);
      }
    });

    socket.ev.on("chats.phoneNumberShare", (share) => {
      recordContactInfo(session, { lid: share.lid, jid: share.jid });
    });

    socket.ev.on("groups.update", (updates) => {
      for (const g of updates) {
        if (g.id) session.groupMetaCache.delete(g.id);
      }
    });

    socket.ev.on("group-participants.update", (update) => {
      if (update?.id) session.groupMetaCache.delete(update.id);
    });

    socket.ev.on("connection.update", (update) => {
      if (update.connection || update.lastDisconnect || update.qr) {
        console.log(
          `[wa-debug] connection.update de ${numberId}:`,
          JSON.stringify({
            connection: update.connection,
            lastDisconnect: update.lastDisconnect?.error
              ? update.lastDisconnect.error instanceof Error
                ? update.lastDisconnect.error.message
                : (update.lastDisconnect.error as unknown)
              : undefined,
            qr: !!update.qr,
          })
        );
      }
      void this.handleConnectionUpdate(numberId, session, update);
    });

    socket.ev.on("messages.upsert", (upsert) => {
      console.log(`[wa-debug] messages.upsert de ${numberId}: type=${upsert.type} count=${upsert.messages.length}`);
      void this.handleMessagesUpsert(numberId, upsert);
    });

    // checks do WhatsApp (mensagens que o painel enviou):
    // chat 1:1 chega como messages.update (update.status) — 2=server, 3=entregue, 4=lido
    socket.ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        if (!key?.id) continue;
        const s = update?.status as number | undefined;
        if (s === 2) void this.applyStatus(numberId, key.id, "SENT");
        else if (s === 3) void this.applyStatus(numberId, key.id, "DELIVERED");
        else if (s === 4 || s === 5) void this.applyStatus(numberId, key.id, "READ");
      }
    });

    // grupos: receipts por participante chegam como message-receipt.update
    socket.ev.on("message-receipt.update", (updates) => {
      for (const { key, receipt } of updates) {
        if (!key?.id) continue;
        if (receipt?.readTimestamp) void this.applyStatus(numberId, key.id, "READ");
        else if (receipt?.receiptTimestamp) void this.applyStatus(numberId, key.id, "DELIVERED");
      }
    });

    return { status: session.status };
  },

  async handleConnectionUpdate(
    numberId: string,
    session: ManagedSession,
    update: {
      qr?: string;
      connection?: "connecting" | "open" | "close";
      lastDisconnect?: { error?: unknown };
      user?: { id?: string };
    }
  ) {
    if (update.qr) {
      session.qr = update.qr;
      session.status = "CONNECTING";
      emitRealtime({ type: "connection:update", numberId, status: "CONNECTING" });
    }

    if (update.connection === "open") {
      session.status = "CONNECTED";
      session.qr = null;
      // identidade propria: connection.update NAO traz `user` nesta versao do
      // Baileys; o correto e creds.me (id/jid = PN real, lid = LID)
      syncSelfIdentity(session);
      const me = (
        session.socket as unknown as {
          authState?: { creds?: { me?: { id?: string; jid?: string; lid?: string } | null } };
        }
      ).authState?.creds?.me;
      const jid = me?.jid?.endsWith("@s.whatsapp.net")
        ? me.jid
        : me?.id?.endsWith("@s.whatsapp.net")
          ? me.id
          : null;
      const phone = jid ? digitsOnly(jid.split("@")[0].split(":")[0]) : null;
      await prisma.whatsAppNumber
        .update({
          where: { id: numberId },
          data: { phone, jid, status: "CONNECTED", lastError: null },
        })
        .catch(() => undefined);
      emitRealtime({ type: "connection:update", numberId, status: "CONNECTED" });
      console.log(
        `[whatsapp] numero ${numberId} conectado (${phone ?? "?"}${session.selfLidDigits ? ` · lid ${session.selfLidDigits}` : ""})`
      );
    }

    if (update.connection === "close") {
      const err = update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
      const code = err?.output?.statusCode ?? -1;
      sessions.delete(numberId);
      clearTimeout(session.reconnectTimer);

      // 401 = deslogado no celular: vira obrgatorio gerar um novo QR
      if (code === DisconnectReason.loggedOut) {
        await rm(sessionPath(numberId), { recursive: true, force: true }).catch(() => undefined);
        await this.setDbStatus(numberId, "DISCONNECTED", "Sessao deslogada no celular");
        emitRealtime({ type: "connection:update", numberId, status: "DISCONNECTED" });
        return;
      }

      // Erros transitorios (internet, restart do WhatsApp) -> reconexao com atraso
      if (!session.stopping) {
        console.log(`[whatsapp] reconectando ${numberId} em 5s (code ${code})`);
        const timer = setTimeout(() => {
          void this.connect(numberId).catch((e) => console.error("[whatsapp] reconexao falhou:", e));
        }, 5000);
        timer.unref?.();
      }
      await this.setDbStatus(numberId, "CONNECTING", `Reconectando (code ${code})`);
      emitRealtime({ type: "connection:update", numberId, status: "CONNECTING" });
    }
  },

  async handleMessagesUpsert(
    numberId: string,
    upsert: { type: string; messages: unknown[] }
  ) {
    for (const rawUnknown of upsert.messages) {
      const msg = rawUnknown as IncomingMessage;
      try {
        const jid = msg.key.remoteJid ?? "";
        if (!jid || jid.endsWith("@status") || jid.endsWith("@newsletter")) continue;
        console.log(
          `[wa-debug] msg: jid=${jid} fromMe=${msg.key.fromMe} ts=${messageTimestampMs(msg)} id=${msg.key.id}`
        );

        // Grupos (@g.us) sao suportados: o contato e o propio grupo
        // e cada mensagem guarda o participante que falou (senderName).
        const isGroup = jid.endsWith("@g.us");

        // mensagem do PROPRIO numero (sync das mensagens que o atendente manda
        // pelo celular): chegam com remoteJid = o LID do proprio numero e viram
        // "conversa consigo mesmo" — descartar
        if (!isGroup) {
          const chatDigits = digitsOnly(jid.split("@")[0].split(":")[0]);
          const session = sessions.get(numberId);
          if (
            session &&
            ((session.selfPnDigits && chatDigits === session.selfPnDigits) ||
              (session.selfLidDigits && chatDigits === session.selfLidDigits))
          ) {
            continue;
          }
        }

        // reacoes chegam como protocolMessage (type = 3): atualizam a
        // mensagem original e nao criam registros novos
        const unwrapped = unwrapMessage(msg);
        const protocol = msg.message?.protocolMessage ?? unwrapped?.protocolMessage;
        // REVOKE (type = 0): o contato apagou mensagens dele(s) "para todos";
        // o painel reforma visualmente a mensagem como "(mensagem apagada)"
        if (protocol && protocol.type === 0 && protocol.key?.id) {
          await this.applyRevocation(numberId, msg);
          continue;
        }
        if (protocol && protocol.type === 3 && protocol.key?.id) {
          await this.applyReaction(numberId, msg);
          continue;
        }

        // alimenta o cache em memoria com identidade/pushName de quem enviou
        if (!msg.key.fromMe) {
          const senderJid = isGroup ? msg.key.participant : jid;
          const senderPn =
            msg.key.participantPn ??
            msg.key.senderPn ??
            (!isGroup ? msg.key.remoteJidAlt : null);
          recordContactInfo(sessions.get(numberId), {
            id: senderJid,
            jid: senderPn,
            lid: isLidJid(senderJid) ? senderJid : undefined,
            notify: msg.pushName ?? undefined,
          });
        }

        // LID: contas novas chegam com "<identificador>@lid" em vez do telefone.
        // Quando o WhatsApp informa o numero real (remoteJidAlt/participantPn/
        // senderPn) usamos ele como chave do contato; o jid LID fica em
        // Contact.jid para as respostas.
        const phone = resolvePhone(msg, jid, isGroup);
        if (!phone) {
          console.log(`[wa-debug] mensagem SEM telefone resolvivel: jid=${jid} fromMe=${msg.key.fromMe}`);
          continue;
        }

        const rawText = extractText(msg);
        const media = extractMedia(msg);
        if (!rawText && !media) continue; // sem conteudo tratavel

        // historico antigo (sync do pareamento) nao entra no inbox
        const ageMs = Date.now() - messageTimestampMs(msg);
        if (ageMs > MAX_BACKFILL_AGE_MS) {
          console.log(
            `[wa-debug] mensagem pulada por idade (${Math.round(ageMs / 3600000)}h): jid=${jid} fromMe=${msg.key.fromMe}`
          );
          continue;
        }

        await this.ingestMessage(numberId, msg, jid, phone, rawText, media, isGroup);
      } catch (error) {
        console.error("[whatsapp] erro ao processar mensagem:", error);
      }
    }
  },

  /**
   * Efetua o "Apagar para todos" no lado do WhatsApp (protocolo REVOKE) —
   * chamado pela rota da API, que grava/marca no banco depois do sucesso.
   * @param participantJid em grupos: jid do participante autor da mensagem
   */
  async deleteMessage(
    numberId: string,
    chatJid: string,
    externalId: string,
    fromMe: boolean,
    participantJid: string | null
  ): Promise<void> {
    const session = sessions.get(numberId);
    if (!session || session.status !== "CONNECTED") {
      throw new Error("Numero WhatsApp nao conectado");
    }
    await session.socket.sendMessage(
      chatJid,
      {
        delete: {
          remoteJid: chatJid,
          id: externalId,
          fromMe,
          ...(participantJid ? { participant: participantJid } : {}),
        },
      } as never
    );
  },

  /**
   * O contato apagou mensagem dele "para todos" (chega como REVOKE):
   * o registro existente passa a exibir "(mensagem apagada)" no painel.
   */
  async applyRevocation(numberId: string, msg: IncomingMessage) {
    const pm = msg.message?.protocolMessage;
    if (!pm?.key?.id) return;
    const target = await prisma.message.findFirst({
      where: { externalId: pm.key.id, conversation: { whatsappNumberId: numberId } },
      select: { id: true, conversationId: true, deleted: true },
    });
    if (!target || target.deleted) return;
    await prisma.message.update({
      where: { id: target.id },
      data: { deleted: true },
    });
    const conv = await prisma.conversation.findUnique({
      where: { id: target.conversationId },
      select: { sectorId: true },
    });
    emitRealtime({
      type: "message:update",
      conversationId: target.conversationId,
      sectorId: conv?.sectorId ?? null,
      message: { id: target.id, deleted: true },
    });
  },

  /**
   * Status "ao vivo" de uma mensagem enviada pelo painel, o check do WhatsApp:
   * SENT (1 visto) -> DELIVERED (2 vistos) -> READ (2 vistos azuis).
   * 1:1 chega via `messages.update` (update.status) e grupos via
   * `message-receipt.update` (receiptTimestamp / readTimestamp).
   * Monotonica: nunca rebaixa READ para DELIVERED.
   */
  async applyStatus(numberId: string, externalId: string, status: string) {
    const STATUS_RANK: Record<string, number> = { SENT: 0, DELIVERED: 1, READ: 2, FAILED: 2 };
    const target = await prisma.message.findFirst({
      where: { externalId, direction: "OUTGOING", conversation: { whatsappNumberId: numberId } },
      select: { id: true, conversationId: true, status: true },
    });
    if (!target) return; // fora do historico importado
    if ((STATUS_RANK[status] ?? 0) <= (STATUS_RANK[target.status] ?? 0)) return;    await prisma.message.update({
      where: { id: target.id },
      data: { status },
    });
    const conv = await prisma.conversation.findUnique({
      where: { id: target.conversationId },
      select: { sectorId: true },
    });
    emitRealtime({
      type: "message:update",
      conversationId: target.conversationId,
      sectorId: conv?.sectorId ?? null,
      message: { id: target.id, status },
    });
  },

  /**
   * Reacao (emoji) recebida do WhatsApp: grava na mensagem alvo
   * (ultima reacao por autor vence; mesmo emoji do mesmo autor remove).
   */
  async applyReaction(numberId: string, msg: IncomingMessage) {
    const pm = msg.message?.protocolMessage;
    if (!pm?.key?.id) return;

    const target = await prisma.message.findFirst({
      where: { externalId: pm.key.id, conversation: { whatsappNumberId: numberId } },
      select: { id: true, conversationId: true, reaction: true, reactionMine: true },
    });
    if (!target) return; // alvo fora do historico importado

    const mine = msg.key.fromMe === true;
    const emoji = (pm.text ?? "").trim();
    // toggle: mesma emoji do mesmo autor apaga a reacao ("clicou de novo")
    const removing = emoji === "" || (target.reaction === emoji && target.reactionMine === mine);

    const updated = await prisma.message.update({
      where: { id: target.id },
      data: { reaction: removing ? null : emoji, reactionMine: removing ? null : mine },
      select: { id: true, reaction: true, reactionMine: true },
    });

    const conv = await prisma.conversation.findUnique({
      where: { id: target.conversationId },
      select: { sectorId: true },
    });
    emitRealtime({
      type: "message:update",
      conversationId: target.conversationId,
      sectorId: conv?.sectorId ?? null,
      message: { id: updated.id, reaction: updated.reaction, reactionMine: updated.reactionMine },
    });
  },

  async ingestMessage(
    numberId: string,
    msg: IncomingMessage,
    jid: string,
    phone: string,
    rawText: string,
    media: IncomingMedia | null,
    isGroup = false
  ) {
    const direction = msg.key.fromMe ? "OUTGOING" : "INCOMING";
    const createdAt = new Date(messageTimestampMs(msg));
    const session = sessions.get(numberId) ?? null;

    // idempotencia: o WA reenvia a mesma mensagem (sync + entregas posteriores)
    if (msg.key.id) {
      const existing = await prisma.message.findFirst({
        where: { externalId: msg.key.id, conversation: { whatsappNumberId: numberId } },
        select: { id: true },
      });
      if (existing) return;
    }

    // 1) contato (guarda o jid real para responder com ele)
    //    grupo: nome vem do subject do grupo (metadata do Baileys em cache)
    let groupMeta: GroupMetaLite | null = null;
    let groupName: string | null = null;
    if (isGroup) {
      groupMeta = await getGroupMetadata(numberId, jid);
      groupName = groupMeta?.subject ?? null;
    }

    // migracao LID -> numero real: contato criado com os digitos do LID passa
    // a usar o numero real assim que o WhatsApp o revela (historico segue
    // ligado ao mesmo contato; o jid LID continua salvo em Contact.jid)
    // pushName: NAO usa em msg fromMe (a copia do celular traz pushName do
    // PROPRIO atendente - "Rodolfo Cesar" - e iria colar no contato errado)
    const contact = await upsertContact(
      msg,
      jid,
      phone,
      isGroup,
      groupName,
      msg.key.fromMe ? null : (msg.pushName ?? null)
    );

    // 2) conversa (PENDING/OPEN) para o par numero + contato
    let conversation = await prisma.conversation.findFirst({
      where: {
        whatsappNumberId: numberId,
        contactId: contact.id,
        status: { in: ["PENDING", "OPEN"] },
      },
      orderBy: { lastMessageAt: "desc" },
    });

    if (!conversation) {
      const whatsappNumber = await prisma.whatsAppNumber.findUnique({
        where: { id: numberId },
        select: { sectorId: true },
      });
      conversation = await prisma.conversation.create({
        data: {
          contactId: contact.id,
          whatsappNumberId: numberId,
          sectorId: whatsappNumber?.sectorId ?? null,
          status: "PENDING",
          lastMessageAt: createdAt,
        },
      });
    }

    const wasClosed = conversation.status === "CLOSED";

    // 2a) resolve mencoes (@176398668947474 -> @Nome / @Você) ja com groupMeta + conversa
    const text = rawText
      ? await resolveTextMentions(numberId, rawText, {
          mentionedJids: extractMentionedJids(msg),
          groupJid: isGroup ? jid : null,
          conversationId: conversation.id,
          groupMeta,
        })
      : rawText;

    // 3) midia (download antes de gravar a mensagem)
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;
    let fileName: string | undefined;
    if (media) {
      const buffer = await downloadMessageMedia(msg);
      if (buffer && buffer.length > 0) {
        mediaUrl = await saveMediaFile(buffer, media.mime);
        mediaType = media.mime;
        fileName = media.fileName || undefined;
      } else {
        console.warn(`[whatsapp] midia descartada (download falhou) conversa ${conversation.id}`);
      }
    }

    // 4) mensagem e citacao
    const quoted = extractQuote(msg);
    const resolvedQuotedSnippet = quoted?.snippet
      ? await resolveTextMentions(numberId, quoted.snippet, {
          mentionedJids: quoted.quotedMentionedJids,
          groupJid: isGroup ? jid : null,
          conversationId: conversation.id,
          groupMeta,
        })
      : null;

    const directory = isGroup
      ? await buildGroupParticipantDirectory(numberId, jid, conversation.id, { groupMeta })
      : null;

    // 4a) nome de quem falou a msg citada
    let quotedSenderName: string | null = null;
    if (quoted?.senderJidDigits) {
      if (
        (session?.selfPnDigits && quoted.senderJidDigits === session.selfPnDigits) ||
        (session?.selfLidDigits && quoted.senderJidDigits === session.selfLidDigits)
      ) {
        quotedSenderName = "Você";
      } else if (isGroup) {
        const dirHit = directory?.byDigits.get(quoted.senderJidDigits);
        if (dirHit) {
          quotedSenderName = dirHit.mentionLabel;
        } else {
          const mappedPn = session?.lidToPn.get(quoted.senderJidDigits) ?? null;
          const digitsCandidates = mappedPn
            ? [quoted.senderJidDigits, mappedPn]
            : [quoted.senderJidDigits];
          const hit = await prisma.message.findFirst({
            where: {
              conversationId: conversation.id,
              senderName: { not: null },
              OR: digitsCandidates.map((d) => ({ senderJid: { contains: d } })),
            },
            orderBy: { createdAt: "desc" },
            select: { senderName: true },
          });
          quotedSenderName =
            hit?.senderName ??
            cachedContactLabel(session ?? undefined, digitsCandidates) ??
            (mappedPn ? formatPhoneDisplay(mappedPn) : null);
        }
      } else {
        quotedSenderName = contact.name ?? null;
      }
    }

    // em grupos, resolve o nome exibido do participante que enviou a mensagem
    let groupSenderName: string | null = null;
    if (isGroup && !msg.key.fromMe) {
      const partDigits = jidDigits(msg.key.participant);
      const pnDigits = jidDigits(msg.key.participantPn) || (partDigits ? session?.lidToPn.get(partDigits) ?? "" : "");
      const dirEntry =
        (partDigits && directory?.byDigits.get(partDigits)) ||
        (pnDigits && directory?.byDigits.get(pnDigits)) ||
        null;
      const pushLabel = isHumanName(msg.pushName) ? msg.pushName!.trim() : null;
      const cacheLabel = cachedContactLabel(
        session ?? undefined,
        [partDigits, pnDigits].filter(Boolean)
      );
      groupSenderName =
        (dirEntry && isHumanName(dirEntry.memberName) ? dirEntry.memberName : null) ||
        pushLabel ||
        cacheLabel ||
        (pnDigits ? formatPhoneDisplay(pnDigits) : null) ||
        partDigits ||
        null;
    }

    const created = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction,
        content: text,
        mediaUrl: mediaUrl ?? null,
        mediaType: mediaType ?? null,
        fileName: fileName ?? null,
        externalId: msg.key.id ?? null,
        status: "SENT",
        // em grupos, guarda quem falou (p/ exibir o nome na bolha)
        senderName: groupSenderName,
        // em grupos: jid do autor (necessario p/ reagir as mensagens dele)
        senderJid: isGroup && !msg.key.fromMe ? (msg.key.participant ?? null) : null,
        // resposta citando outra mensagem ("responder" do WhatsApp)
        quotedSnippet: resolvedQuotedSnippet,
        forwarded: detectForwarded(msg),
        quotedSender: quoted?.sender ?? null,
        quotedSenderName,
        createdAt,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: createdAt,
        // mensagem nova em conversa encerrada reabre como PENDING
        ...(wasClosed ? { status: "PENDING", closedAt: null } : {}),
      },
    });

    emitRealtime({
      type: "message:new",
      conversationId: conversation.id,
      sectorId: conversation.sectorId,
      message: { ...created, conversationStatus: wasClosed ? "PENDING" : conversation.status },
    });
    emitRealtime({
      type: "conversation:update",
      conversationId: conversation.id,
      sectorId: conversation.sectorId,
      status: wasClosed ? "PENDING" : conversation.status,
    });

    if (direction === "INCOMING") {
      const senderTitle = contact.name?.trim() || contact.phone;
      const preview = (text && text.trim()) || (mediaType ? "[Mídia]" : "Nova mensagem");
      void sendIncomingMessagePush({
        conversationId: conversation.id,
        sectorId: conversation.sectorId,
        assignedUserId: conversation.assignedUserId,
        title: senderTitle,
        body: preview.slice(0, 140),
      }).catch((err) => console.warn("[push] erro ao disparar:", err));
    }
  },

  async getGroupMembers(
    numberId: string,
    groupJid: string,
    conversationId: string | null,
    opts?: { force?: boolean; selfPhoneFallback?: string | null }
  ): Promise<GroupInfoDTO> {
    const dir = await buildGroupParticipantDirectory(numberId, groupJid, conversationId, opts);
    return {
      subject: dir.meta?.subject ?? null,
      description: dir.meta?.desc ?? null,
      size: dir.meta?.size ?? dir.members.length,
      addressingMode: dir.meta?.addressingMode ?? null,
      connected: dir.connected,
      fallbackFromHistory: !dir.meta,
      members: dir.members,
    };
  },

  async resolveStoredGroupMentions<T extends { content: string; quotedSnippet?: string | null }>(
    numberId: string,
    groupJid: string,
    conversationId: string | null,
    items: T[],
    selfPhoneFallback?: string | null
  ): Promise<T[]> {
    const needsResolution = items.some(
      (item) =>
        (item.content && RAW_MENTION_TEST_RE.test(item.content)) ||
        (item.quotedSnippet && RAW_MENTION_TEST_RE.test(item.quotedSnippet))
    );
    if (!needsResolution) return items;

    const session = sessions.get(numberId);
    const { selfPnDigits, selfLidDigits } = await getSelfDigits(numberId, selfPhoneFallback);
    const directory = await buildGroupParticipantDirectory(numberId, groupJid, conversationId, {
      selfPhoneFallback,
    });

    const labels = new Map<string, string>();
    const missing = new Set<string>();

    const scan = (str?: string | null) => {
      if (!str || !str.includes("@")) return;
      for (const m of str.matchAll(RAW_MENTION_FIND_RE)) {
        const d = m[1];
        if (!d || labels.has(d)) continue;
        if ((selfPnDigits && d === selfPnDigits) || (selfLidDigits && d === selfLidDigits)) {
          labels.set(d, "Você");
          continue;
        }
        const dirHit = directory.byDigits.get(d);
        if (dirHit) {
          labels.set(d, dirHit.mentionLabel);
          continue;
        }
        missing.add(d);
      }
    };

    for (const item of items) {
      scan(item.content);
      scan(item.quotedSnippet);
    }

    if (missing.size > 0) {
      const missingArr = [...missing];
      const mappedPns = missingArr
        .map((d) => session?.lidToPn.get(d))
        .filter((v): v is string => Boolean(v));
      const allLookupDigits = [...new Set([...missingArr, ...mappedPns])];

      const [contacts, fallbackMsgs] = await Promise.all([
        prisma.contact.findMany({
          where: {
            isGroup: false,
            OR: [
              { phone: { in: allLookupDigits } },
              ...allLookupDigits.map((d) => ({ jid: { contains: d } })),
            ],
          },
          select: { jid: true, phone: true, name: true, pushName: true },
        }),
        prisma.message.findMany({
          where: {
            senderName: { not: null },
            OR: allLookupDigits.map((d) => ({ senderJid: { contains: d } })),
          },
          orderBy: { createdAt: "desc" },
          take: 150,
          select: { conversationId: true, senderJid: true, senderName: true },
        }),
      ]);

      for (const d of missingArr) {
        const mappedPn = session?.lidToPn.get(d) ?? null;
        const contactHit = contacts.find(
          (c) =>
            c.phone === d ||
            jidDigits(c.jid) === d ||
            (mappedPn && (c.phone === mappedPn || jidDigits(c.jid) === mappedPn))
        );
        const dbLabel =
          (isHumanName(contactHit?.name) ? contactHit!.name!.trim() : null) ||
          (isHumanName(contactHit?.pushName) ? contactHit!.pushName!.trim() : null);
        if (dbLabel) {
          labels.set(d, dbLabel);
          continue;
        }

        const cacheLabel = cachedContactLabel(session, mappedPn ? [d, mappedPn] : [d]);
        if (cacheLabel) {
          labels.set(d, cacheLabel);
          continue;
        }

        const msgHits = fallbackMsgs.filter((m) => {
          const sd = jidDigits(m.senderJid);
          return (sd === d || (mappedPn && sd === mappedPn)) && isHumanName(m.senderName);
        });
        const sameConv = conversationId
          ? msgHits.find((m) => m.conversationId === conversationId)
          : undefined;
        const chosen = sameConv ?? msgHits[0];
        if (chosen?.senderName) {
          labels.set(d, chosen.senderName.trim());
          continue;
        }

        const pnFromContact =
          contactHit && isPhoneJid(contactHit.jid) ? jidDigits(contactHit.jid) : null;
        const knownPn = mappedPn || pnFromContact;
        if (knownPn) {
          labels.set(d, formatPhoneDisplay(knownPn));
        }
      }
    }

    if (labels.size === 0) return items;

    return items.map((item) => ({
      ...item,
      content: replaceMentionTokens(item.content, labels),
      ...(item.quotedSnippet !== undefined
        ? {
            quotedSnippet: item.quotedSnippet
              ? replaceMentionTokens(item.quotedSnippet, labels)
              : item.quotedSnippet,
          }
        : {}),
    }));
  },

  async sendMessage(
    numberId: string,
    toPhone: string,
    text: string,
    toJid?: string | null,
    mentions?: string[]
  ): Promise<{ externalId: string | null }> {
    const session = sessions.get(numberId);
    if (!session || session.status !== "CONNECTED") {
      throw new Error("Numero WhatsApp nao conectado");
    }
    const jid = toJid?.includes("@") ? toJid : `${digitsOnly(toPhone)}@s.whatsapp.net`;
    const result = await session.socket.sendMessage(jid, {
      text,
      ...(mentions?.length ? { mentions } : {}),
    });
    return { externalId: result?.key?.id ?? null };
  },

  /** Envia midia (imagem/video/audio/documento) com legenda opcional. */
  async sendMedia(
    numberId: string,
    toPhone: string,
    buffer: Buffer,
    mime: string,
    caption: string,
    fileName?: string,
    toJid?: string | null,
    mentions?: string[]
  ): Promise<{ externalId: string | null }> {
    const session = sessions.get(numberId);
    if (!session || session.status !== "CONNECTED") {
      throw new Error("Numero WhatsApp nao conectado");
    }
    const jid = toJid?.includes("@") ? toJid : `${digitsOnly(toPhone)}@s.whatsapp.net`;
    const mentionOpt = mentions?.length ? { mentions } : {};

    const content = mime.startsWith("image/")
      ? { image: buffer, caption: caption || undefined, mimetype: mime, ...mentionOpt }
      : mime.startsWith("video/")
        ? { video: buffer, caption: caption || undefined, mimetype: mime, ...mentionOpt }
        : mime.startsWith("audio/")
          ? { audio: buffer, mimetype: mime }
          : {
              document: buffer,
              mimetype: mime,
              fileName: fileName || "arquivo",
              caption: caption || undefined,
              ...mentionOpt,
            };

    const result = await session.socket.sendMessage(jid, content as never);
    return { externalId: result?.key?.id ?? null };
  },

  /**
   * Reage a uma mensagem na conversa (ou remove a reacao com emoji vazio).
   * @param targetFromMe true quando a mensagem alvo saiu do nosso numero
   * @param participantJid em grupos: jid do autor da mensagem alvo
   */
  async sendReaction(
    numberId: string,
    chatJid: string,
    targetExternalId: string,
    targetFromMe: boolean,
    participantJid: string | null,
    emoji: string
  ): Promise<void> {
    const session = sessions.get(numberId);
    if (!session || session.status !== "CONNECTED") {
      throw new Error("Numero WhatsApp nao conectado");
    }
    await session.socket.sendMessage(chatJid, {
      react: {
        text: emoji,
        key: {
          remoteJid: chatJid,
          id: targetExternalId,
          fromMe: targetFromMe,
          ...(participantJid ? { participant: participantJid } : {}),
        },
      },
    } as never);
  },

  /** Desconecta e apaga a sessao local (novo QR passa a ser obrigatorio). */
  async logout(numberId: string): Promise<void> {
    const session = sessions.get(numberId);
    if (session) {
      session.stopping = true;
      clearTimeout(session.reconnectTimer);
      try {
        await session.socket.logout("logout solicitado pelo painel");
      } catch {
        try {
          session.socket.end(undefined);
        } catch {
          /* sessao ja encerrada */
        }
      }
      sessions.delete(numberId);
    }
    await rm(sessionPath(numberId), { recursive: true, force: true }).catch(() => undefined);
    await this.setDbStatus(numberId, "DISCONNECTED");
    emitRealtime({ type: "connection:update", numberId, status: "DISCONNECTED" });
  },

  async setDbStatus(numberId: string, status: NumberStatus, error?: string) {
    await prisma.whatsAppNumber
      .update({
        where: { id: numberId },
        data: { status, lastError: error ?? null },
      })
      .catch(() => undefined);
  },
};

export type WhatsAppManagerApi = typeof waManager;
