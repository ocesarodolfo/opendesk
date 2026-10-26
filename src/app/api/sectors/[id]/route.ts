import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

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

  const data: { name?: string; description?: string | null; active?: boolean } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.description === "string") data.description = body.description;
  if (typeof body.active === "boolean") data.active = body.active;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  const sector = await prisma.sector.update({ where: { id }, data });

  const changes: string[] = [];
  if (data.name !== undefined) changes.push(`nome "${data.name}"`);
  if (data.active !== undefined) changes.push(data.active ? "ativado" : "desativado");
  if (data.description !== undefined) changes.push("descricao");
  void auditLog({
    action: AUDIT_ACTIONS.SETOR_ATUALIZADO,
    entity: "Sector",
    entityId: id,
    detail: `"${sector.name}": ${changes.join(", ")}`,
    session,
    req,
  });

  return NextResponse.json(sector);
}
