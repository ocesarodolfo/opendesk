import "server-only";
import path from "node:path";
import { rm } from "node:fs/promises";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
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
};

type IncomingMedia = { mime: string; caption: string; fileName: string };

type ManagedSession = {
  socket: ReturnType<typeof makeWASocket>;
  status: NumberStatus;
  qr: string | null;
  // identidade do PROPRIA numero da sessao (para descartar sync de
  // mensagens enviadas pelo celular, que chegam com remoteJid = nos mesmos)
  selfPnDigits?: string | null;
  selfLidDigits?: string | null;
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

function extractText(msg: IncomingMessage): string {
  const m = msg.message;
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
  const m = msg.message;
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
  const m = msg.message;
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
  const quoted = ci?.quotedMessage;
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
  const m = msg.message;
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

    const session: ManagedSession = { socket, status: "CONNECTING", qr: null };
    sessions.set(numberId, session);
    // creds do disco podem ja carregar a identidade propria (sessoes antigas)
    syncSelfIdentity(session);
    await this.setDbStatus(numberId, "CONNECTING");

    socket.ev.on("creds.update", saveCreds);

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
        const protocol = msg.message?.protocolMessage;
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

        // LID: contas novas chegam com "<identificador>@lid" em vez do telefone.
        // Quando o WhatsApp informa o numero real (remoteJidAlt/participantPn/
        // senderPn) usamos ele como chave do contato; o jid LID fica em
        // Contact.jid para as respostas.
        const phone = resolvePhone(msg, jid, isGroup);
        if (!phone) {
          console.log(`[wa-debug] mensagem SEM telefone resolvivel: jid=${jid} fromMe=${msg.key.fromMe}`);
          continue;
        }

        const text = extractText(msg);
        const media = extractMedia(msg);
        if (!text && !media) continue; // sem conteudo tratavel

        // historico antigo (sync do pareamento) nao entra no inbox
        const ageMs = Date.now() - messageTimestampMs(msg);
        if (ageMs > MAX_BACKFILL_AGE_MS) {
          console.log(
            `[wa-debug] mensagem pulada por idade (${Math.round(ageMs / 3600000)}h): jid=${jid} fromMe=${msg.key.fromMe}`
          );
          continue;
        }

        await this.ingestMessage(numberId, msg, jid, phone, text, media, isGroup);
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
    text: string,
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
    //    grupo: nome vem do subject do grupo (metadata do Baileys)
    let groupName: string | null = null;
    if (isGroup) {
      const meta = await sessions
        .get(numberId)
        ?.socket.groupMetadata(jid)
        .catch(() => null);
      groupName = meta?.subject ?? null;
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

    // 4) mensagem
    const quoted = extractQuote(msg);
    // resposta citando outra mensagem ("responder" do WhatsApp)
    // 4a) nome de quem falou a msg citada: grupos -> nome do participante
    // obtido de mensagens anteriores da MESMA conversa; 1:1 -> o nome do
    // contato (a citacao dele vem sempre sem PN util); autor = nosso numero
    // (copiado do celular) -> "Você"
    let quotedSenderName: string | null = null;
    if (quoted?.senderJidDigits) {
      if (
        (session?.selfPnDigits && quoted.senderJidDigits === session.selfPnDigits) ||
        (session?.selfLidDigits && quoted.senderJidDigits === session.selfLidDigits)
      ) {
        quotedSenderName = "Você";
      } else if (isGroup) {
        const hit = await prisma.message.findFirst({
          where: {
            conversationId: conversation.id,
            senderName: { not: null },
            senderJid: { contains: quoted.senderJidDigits },
          },
          orderBy: { createdAt: "desc" },
          select: { senderName: true },
        });
        quotedSenderName = hit?.senderName ?? null;
      } else {
        quotedSenderName = contact.name ?? null;
      }
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
        senderName:
          isGroup && !msg.key.fromMe
            ? msg.pushName ??
              digitsOnly((msg.key.participantPn ?? msg.key.participant ?? "").split("@")[0]) ??
              null
            : null,
        // em grupos: jid do autor (necessario p/ reagir as mensagens dele)
        senderJid: isGroup && !msg.key.fromMe ? (msg.key.participant ?? null) : null,
        // resposta citando outra mensagem ("responder" do WhatsApp)
        quotedSnippet: quoted?.snippet ?? null,
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

  async sendMessage(
    numberId: string,
    toPhone: string,
    text: string,
    toJid?: string | null
  ): Promise<{ externalId: string | null }> {
    const session = sessions.get(numberId);
    if (!session || session.status !== "CONNECTED") {
      throw new Error("Numero WhatsApp nao conectado");
    }
    const jid = toJid?.includes("@") ? toJid : `${digitsOnly(toPhone)}@s.whatsapp.net`;
    const result = await session.socket.sendMessage(jid, { text });
    return { externalId: result?.key?.id ?? null };
  },

  /** Envia midia (imagem/video/audio/documento) com legenda opcional. */  async sendMedia(
    numberId: string,
    toPhone: string,
    buffer: Buffer,
    mime: string,
    caption: string,
    fileName?: string,
    toJid?: string | null
  ): Promise<{ externalId: string | null }> {
    const session = sessions.get(numberId);
    if (!session || session.status !== "CONNECTED") {
      throw new Error("Numero WhatsApp nao conectado");
    }
    const jid = toJid?.includes("@") ? toJid : `${digitsOnly(toPhone)}@s.whatsapp.net`;

    const content = mime.startsWith("image/")
      ? { image: buffer, caption: caption || undefined, mimetype: mime }
      : mime.startsWith("video/")
        ? { video: buffer, caption: caption || undefined, mimetype: mime }
        : mime.startsWith("audio/")
          ? { audio: buffer, mimetype: mime }
          : {
              document: buffer,
              mimetype: mime,
              fileName: fileName || "arquivo",
              caption: caption || undefined,
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
