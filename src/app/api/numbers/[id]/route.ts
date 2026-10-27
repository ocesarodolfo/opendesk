import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { waManager } from "@/lib/whatsapp/manager";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

// Atualiza configuracao do numero (admin): prefixo de atendente nas mensagens
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.prefixAgent !== "boolean") {
    return NextResponse.json({ error: "Informe prefixAgent (boolean)." }, { status: 400 });
  }

  const updated = await prisma.whatsAppNumber
    .update({ where: { id }, data: { prefixAgent: body.prefixAgent } })
    .catch(() => null);
  if (!updated) return NextResponse.json({ error: "Numero inexistente." }, { status: 404 });

  void auditLog({
    action: AUDIT_ACTIONS.NUMERO_ATUALIZADO,
    entity: "WhatsAppNumber",
    entityId: id,
    detail: `prefixAgent = ${body.prefixAgent}`,
    session,
    req,
  });

  return NextResponse.json({ id, prefixAgent: updated.prefixAgent });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });
  }

  const { id } = await params;
  const target = await prisma.whatsAppNumber.findUnique({
    where: { id },
    select: { label: true },
  });
  // encerra a sessao e apaga as credenciais antes de remover o registro
  await waManager.logout(id).catch(() => undefined);
  // tolerante: se o registro ja nao existe (ex.: removido em outra aba), segue
  await prisma.whatsAppNumber.delete({ where: { id } }).catch(() => undefined);

  void auditLog({
    action: AUDIT_ACTIONS.NUMERO_EXCLUIDO,
    entity: "WhatsAppNumber",
    entityId: id,
    detail: target ? `"${target.label}"` : id,
    session,
    req,
  });

  return NextResponse.json({ ok: true });
}
