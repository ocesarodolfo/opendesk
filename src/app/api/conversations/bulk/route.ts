import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getSupervisorSectorIds } from "@/lib/scope";
import { emitRealtime } from "@/lib/realtime";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

// Atribuicao EM LOTE (poder de SUPERVISOR do setor ou ADMIN).
// Body: { conversationIds: string[], assignedUserId: string | null }
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.conversationIds)
    ? (body.conversationIds.filter((v: unknown) => typeof v === "string") as string[])
    : [];
  const assignedUserId =
    body.assignedUserId === null || typeof body.assignedUserId === "string"
      ? (body.assignedUserId as string | null)
      : undefined;

  if (ids.length === 0 || ids.length > 50) {
    return NextResponse.json(
      { error: "Selecione de 1 a 50 conversas." },
      { status: 400 }
    );
  }
  if (assignedUserId === undefined) {
    return NextResponse.json({ error: "Informe assignedUserId." }, { status: 400 });
  }

  // ADMIN: tudo. AGENT: apenas conversas de setores em que e SUPERVISOR
  // (conversas "sem setor" sao nivel empresa — lote também fica com ADMIN)
  let allowedSectorIds: string[] | null;
  if (session.role === "ADMIN") {
    allowedSectorIds = null; // sem restricao
  } else {
    const supervisorIds = await getSupervisorSectorIds(session);
    if (supervisorIds.length === 0) {
      return NextResponse.json(
        { error: "Apenas supervisores fazem atribuicao em lote." },
        { status: 403 }
      );
    }
    allowedSectorIds = supervisorIds;
  }

  const conversations = await prisma.conversation.findMany({
    where: { id: { in: ids } },
    select: { id: true, sectorId: true },
  });

  const allowed = conversations.filter(
    (c) => allowedSectorIds === null || (c.sectorId !== null && allowedSectorIds.includes(c.sectorId))
  );

  if (allowed.length === 0) {
    return NextResponse.json(
      { error: "Sem permissao para as conversas selecionadas." },
      { status: 403 }
    );
  }

  // valida que o atendente existe (evita FK quebrada -> 500)
  if (assignedUserId !== null) {
    const user = await prisma.user.findUnique({ where: { id: assignedUserId } });
    if (!user) {
      return NextResponse.json({ error: "Atendente inexistente." }, { status: 400 });
    }
  }

  const targetIds = allowed.map((c) => c.id);
  await prisma.conversation.updateMany({
    where: { id: { in: targetIds } },
    data: { assignedUserId },
  });

  for (const id of targetIds) {
    emitRealtime({ type: "conversation:update", conversationId: id });
  }

  void auditLog({
    action: AUDIT_ACTIONS.CONVERSA_LOTE,
    entity: "Conversation",
    detail: `${targetIds.length} conversa(s) atribuida(s) a ${assignedUserId ?? "-"}`,
    session,
    req,
    metadata: { ids: targetIds, assignedUserId },
  });

  return NextResponse.json({ updated: targetIds.length });
}
