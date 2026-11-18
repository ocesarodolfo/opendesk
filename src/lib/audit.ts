import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Trilha de auditoria. API pensada p/ call-and-forget nos handlers de rota:
 *
 *   await auditLog({
 *     action: "CONVERSA_STATUS",
 *     entity: "Conversation",
 *     entityId: conv.id,
 *     detail: `status ${antes} -> ${depois}`,
 *     session,           // getSession() -> quem fez
 *     req,               // NextRequest -> ip/userAgent
 *     metadata: { antes, depois },
 *   });
 *
 * Nunca deve quebrar a acao principal: erro de auditoria e' logado e ignorado.
 */

/** Sessao de quem fez a acao — formato igual ao getSession() (SessionPayload). */
export type AuditSession = { sub: string; name: string; role: string } | null;

export type AuditInput = {
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: string | null;
  /** sessao de quem fez (getSession()). null/omitido = acao do sistema. */
  session?: AuditSession;
  /** Request da rota, p/ capturar ip + userAgent. Omitido em rotas internas. */
  req?: { headers: Headers } | null;
  /** JSON serializavel com o antes/depois (freio de espaco: 4 KB) */
  metadata?: unknown;
};

function clientIp(req?: { headers: Headers } | null): string | null {
  if (!req) return null;
  const fwd = req.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  if (first) return first;
  return req.headers.get("x-real-ip") ?? null;
}

export async function auditLog(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        detail: input.detail?.slice(0, 500) ?? null,
        actorId: input.session?.sub ?? null,
        actorName: input.session?.name ?? null,
        ip: clientIp(input.req),
        userAgent: input.req?.headers.get("user-agent")?.slice(0, 250) ?? null,
        metadata:
          input.metadata !== undefined
            ? JSON.stringify(input.metadata).slice(0, 4000)
            : null,
      },
    });
  } catch (error) {
    // auditoria falha nao deve derrubar a acao original
    console.error("[auditoria] falha ao registrar:", error);
  }
}

/** Nomes canonicos das acoes (evita string solta espalhada no codigo). */
export const AUDIT_ACTIONS = {
  LOGIN: "LOGIN",
  LOGIN_FALHA: "LOGIN_FALHA",
  LOGOUT: "LOGOUT",
  SENHA_TROCA: "SENHA_TROCA",

  CONVERSA_STATUS: "CONVERSA_STATUS",
  CONVERSA_ATRIBUICAO: "CONVERSA_ATRIBUICAO",
  CONVERSA_SETOR: "CONVERSA_SETOR",
  CONVERSA_LOTE: "CONVERSA_LOTE",
  CONVERSA_EXCLUIDA: "CONVERSA_EXCLUIDA",
  MENSAGEM_ENVIADA: "MENSAGEM_ENVIADA",
  MIDIA_ENVIADA: "MIDIA_ENVIADA",
  REACAO: "REACAO",

  CONTATO_RENOME: "CONTATO_RENOME",
  CONTATO_ETIQUETAS: "CONTATO_ETIQUETAS",

  USUARIO_CRIADO: "USUARIO_CRIADO",
  USUARIO_ATUALIZADO: "USUARIO_ATUALIZADO",
  USUARIO_EXCLUIDO: "USUARIO_EXCLUIDO",

  SETOR_CRIADO: "SETOR_CRIADO",
  SETOR_ATUALIZADO: "SETOR_ATUALIZADO",
  SETOR_EXCLUIDO: "SETOR_EXCLUIDO",

  ETIQUETA_CRIADA: "ETIQUETA_CRIADA",
  ETIQUETA_ATUALIZADA: "ETIQUETA_ATUALIZADA",
  ETIQUETA_EXCLUIDA: "ETIQUETA_EXCLUIDA",

  RESPOSTA_CRIADA: "RESPOSTA_CRIADA",
  RESPOSTA_ATUALIZADA: "RESPOSTA_ATUALIZADA",
  RESPOSTA_EXCLUIDA: "RESPOSTA_EXCLUIDA",

  NUMERO_CRIADO: "NUMERO_CRIADO",
  NUMERO_EXCLUIDO: "NUMERO_EXCLUIDO",
  NUMERO_CONEXAO: "NUMERO_CONEXAO",
  NUMERO_ATUALIZADO: "NUMERO_ATUALIZADO",
  MENSAGEM_APAGADA: "MENSAGEM_APAGADA",
} as const;
