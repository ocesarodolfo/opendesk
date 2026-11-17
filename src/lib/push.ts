import "server-only";
import crypto from "node:crypto";
import * as webpush from "web-push";
import { prisma } from "@/lib/prisma";

let configuredForKey: string | null = null;

function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:admin@ozonhub.com.br";
  return { publicKey, privateKey, subject };
}

export function getVapidPublicKey(): string | null {
  const { publicKey, privateKey } = getVapidConfig();
  return publicKey && privateKey ? publicKey : null;
}

export function hashEndpoint(endpoint: string): string {
  return crypto.createHash("sha256").update(endpoint).digest("hex");
}

function ensureConfigured(): boolean {
  const { publicKey, privateKey, subject } = getVapidConfig();
  if (!publicKey || !privateKey) return false;
  const keyTag = `${publicKey}:${privateKey}:${subject}`;
  if (configuredForKey !== keyTag) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configuredForKey = keyTag;
  }
  return true;
}

export async function sendIncomingMessagePush(params: {
  conversationId: string;
  sectorId: string | null;
  assignedUserId: string | null;
  title: string;
  body: string;
}): Promise<void> {
  if (!ensureConfigured()) return;

  // Se a conversa ja esta atribuida a um atendente, notifica apenas ele (ou admins);
  // se nao esta atribuida, notifica todos os usuarios ativos com visibilidade no setor.
  const userWhere = params.assignedUserId
    ? { active: true, id: params.assignedUserId }
    : params.sectorId
      ? {
          active: true,
          OR: [
            { role: "ADMIN" },
            { memberships: { some: { sectorId: params.sectorId } } },
          ],
        }
      : { active: true };

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { user: userWhere },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title: params.title,
    body: params.body,
    tag: `conv-${params.conversationId}`,
    url: `/inbox?c=${encodeURIComponent(params.conversationId)}`,
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
      } catch (err: unknown) {
        const statusCode =
          typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        // 404/410: inscricao expirada ou revogada pelo navegador
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        } else {
          console.warn("[push] falha ao enviar notificacao:", err);
        }
      }
    })
  );
}

