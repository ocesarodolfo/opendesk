import "server-only";
import path from "node:path";
import { rm } from "node:fs/promises";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { prisma } from "@/lib/prisma";
import { emitRealtime } from "@/lib/realtime";
import { saveMediaFile } from "@/lib/media";

const logger = pino({ level: "silent" });

export type NumberStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED";

type IncomingMessage = {
  key: {
    remoteJid?: string | null;
    fromMe?: boolean;
    id?: string | null;
  };
  message?:
    | {
        conversation?: string;
        extendedTextMessage?: { text?: string };
        imageMessage?: { mimetype?: string; caption?: string };
        videoMessage?: { mimetype?: string; caption?: string };
        audioMessage?: { mimetype?: string };
        documentMessage?: { mimetype?: string; caption?: string; fileName?: string };
      }
    | null;
  messageTimestamp?: unknown;
  pushName?: string | null;
};

type IncomingMedia = { mime: string; caption: string; fileName: string };

type ManagedSession = {
  socket: ReturnType<typeof makeWASocket>;
  status: NumberStatus;
  qr: string | null;
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

/**
 * Baixa a midia da mensagem (quando existir). Retorna null se nao houver
 * midia ou se o download falhar (a mensagem segue como texto).
 */
async function downloadMessageMedia(
  socket: ReturnType<typeof makeWASocket>,
  msg: unknown
): Promise<Buffer | null> {
  try {
    const raw = socket as unknown as {
      downloadMediaMessage: (m: unknown) => Promise<Buffer>;
    };
    return await raw.downloadMediaMessage(msg);
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
    await this.setDbStatus(numberId, "CONNECTING");

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(numberId, session, update);
    });

    socket.ev.on("messages.upsert", (upsert) => {
      void this.handleMessagesUpsert(numberId, upsert);
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
      const jid = update.user?.id ?? null;
      const phone = jid ? digitsOnly(jid.split("@")[0].split(":")[0]) : null;
      await prisma.whatsAppNumber
        .update({
          where: { id: numberId },
          data: { phone, jid, status: "CONNECTED", lastError: null },
        })
        .catch(() => undefined);
      emitRealtime({ type: "connection:update", numberId, status: "CONNECTED" });
      console.log(`[whatsapp] numero ${numberId} conectado (${phone ?? "?"})`);
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
        if (!jid || jid.endsWith("@status") || jid.endsWith("@newsletter") || jid.endsWith("@g.us")) continue;

        const remoteAlt = (msg.key as { remoteJidAlt?: string }).remoteJidAlt;
        // LID: contas novas chegam com "<identificador>@lid" em vez do telefone.
        // Sem remoteJidAlt, usamos os digitos do proprio LID como chave do contato
        // (estaveis) e guardamos o jid em Contact.jid para responder por ele.
        const phone = jid.endsWith("@lid")
          ? remoteAlt?.endsWith("@s.whatsapp.net")
            ? digitsOnly(remoteAlt.split("@")[0])
            : digitsOnly(jid.split("@")[0])
          : digitsOnly(jid.split("@")[0].split(":")[0]);
        if (!phone) continue;

        const text = extractText(msg);
        const media = extractMedia(msg);
        if (!text && !media) continue; // sem conteudo tratavel

        // historico antigo (sync do pareamento) nao entra no inbox
        const ageMs = Date.now() - messageTimestampMs(msg);
        if (ageMs > MAX_BACKFILL_AGE_MS) continue;

        await this.ingestMessage(numberId, msg, jid, phone, text, media);
      } catch (error) {
        console.error("[whatsapp] erro ao processar mensagem:", error);
      }
    }
  },

  async ingestMessage(
    numberId: string,
    msg: IncomingMessage,
    jid: string,
    phone: string,
    text: string,
    media: IncomingMedia | null
  ) {
    const direction = msg.key.fromMe ? "OUTGOING" : "INCOMING";
    const createdAt = new Date(messageTimestampMs(msg));

    // idempotencia: o WA reenvia a mesma mensagem (sync + entregas posteriores)
    if (msg.key.id) {
      const existing = await prisma.message.findFirst({
        where: { externalId: msg.key.id, conversation: { whatsappNumberId: numberId } },
        select: { id: true },
      });
      if (existing) return;
    }

    // 1) contato (guarda o jid real para responder com ele)
    const contact = await prisma.contact.upsert({
      where: { phone },
      update: { updatedAt: new Date(), jid },
      create: { phone, pushName: msg.pushName ?? null, jid },
    });

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
      const socket = sessions.get(numberId)?.socket;
      const buffer = socket ? await downloadMessageMedia(socket, msg) : null;
      if (buffer && buffer.length > 0) {
        mediaUrl = await saveMediaFile(buffer, media.mime);
        mediaType = media.mime;
        fileName = media.fileName || undefined;
      } else {
        console.warn(`[whatsapp] midia descartada (download falhou) conversa ${conversation.id}`);
      }
    }

    // 4) mensagem
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction,
        content: text,
        mediaUrl: mediaUrl ?? null,
        mediaType: mediaType ?? null,
        fileName: fileName ?? null,
        externalId: msg.key.id ?? null,
        status: "SENT",
        createdAt,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: createdAt,
        // mensagem nova em conversa encerrada reabre como PENDING
        ...(wasClosed ? { status: "PENDING" } : {}),
      },
    });

    emitRealtime({
      type: "message:new",
      conversationId: conversation.id,
      sectorId: conversation.sectorId,
      message: { ...message, conversationStatus: wasClosed ? "PENDING" : conversation.status },
    });
    emitRealtime({
      type: "conversation:update",
      conversationId: conversation.id,
      sectorId: conversation.sectorId,
      status: wasClosed ? "PENDING" : conversation.status,
    });
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

  /** Envia midia (imagem/video/audio/documento) com legenda opcional. */
  async sendMedia(
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
