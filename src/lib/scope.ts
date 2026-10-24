import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";

/**
 * Escopo de visibilidade por setor (F3):
 * - ADMIN ve tudo;
 * - AGENT ve conversas de setores em que tem vinculo (SectorMembership)
 *   e conversas de numeros **sem setor** (nivel empresa).
 *
 * O filtro e aplicado SEMPRE no servidor — a UI nao precisa (nem deve)
 * saber a regra; conversas fora do escopo simplesmente nao sao listadas
 * e rotas individuais respondem 403.
 */

export type SectorScope = { kind: "ALL" } | { kind: "LIST"; sectorIds: string[] };

/** Setores visiveis para a sessao atual. */
export async function getSectorScope(user: SessionPayload): Promise<SectorScope> {
  if (user.role === "ADMIN") return { kind: "ALL" };

  const memberships = await prisma.sectorMembership.findMany({
    where: { userId: user.sub },
    select: { sectorId: true },
  });
  return { kind: "LIST", sectorIds: memberships.map((m) => m.sectorId) };
}

/** Fragmento `where` do Prisma para listar apenas conversas visiveis. */
export function conversationVisibilityFilter(scope: SectorScope) {
  if (scope.kind === "ALL") return {};
  // sem vinculo nenhum: so conversas de numeros sem setor
  if (scope.sectorIds.length === 0) return { sectorId: null };
  return { OR: [{ sectorId: null }, { sectorId: { in: scope.sectorIds } }] };
}

/** Conversa individual esta dentro do escopo da sessao? */
export function canViewConversation(scope: SectorScope, sectorId: string | null): boolean {
  if (scope.kind === "ALL") return true;
  // conversa de numero sem setor: nivel empresa (visivel a todos)
  if (sectorId === null) return true;
  return scope.sectorIds.includes(sectorId);
}

/**
 * Setores em que o usuario e SUPERVISOR (membership.role).
 * ADMIN e representado como tudo via papel global; aqui devolvemos vazio
 * (o ADMIN usa `getSectorScope` para "ALL").
 */
export async function getSupervisorSectorIds(user: SessionPayload): Promise<string[]> {
  if (user.role === "ADMIN") return [];
  const supervising = await prisma.sectorMembership.findMany({
    where: { userId: user.sub, role: "SUPERVISOR" },
    select: { sectorId: true },
  });
  return supervising.map((m) => m.sectorId);
}

/** Troca de setor da conversa (transferencia entre setores) e papel de ADMIN. */
export function canChangeSector(user: SessionPayload): boolean {
  return user.role === "ADMIN";
}
