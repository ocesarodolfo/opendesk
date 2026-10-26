import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const sectors = await prisma.sector.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { numbers: true, conversations: true, memberships: true } } },
  });
  return NextResponse.json(sectors);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Informe o nome do setor." }, { status: 400 });

  try {
    const sector = await prisma.sector.create({
      data: { name, description: body.description ?? null },
    });
    void auditLog({
      action: AUDIT_ACTIONS.SETOR_CRIADO,
      entity: "Sector",
      entityId: sector.id,
      detail: `"${name}"`,
      session,
      req,
    });
    return NextResponse.json(sector, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Ja existe um setor com esse nome." }, { status: 409 });
  }
}
