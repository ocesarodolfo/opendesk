import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";

// Regra de protecao: um ADMIN nao pode inativar o proprio cadastro
// (evita perder o ultimo acesso de emergencia).
// Por enquanto, a mudanca de senha e o reset do ADMIN passam por aqui.
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

  const data: { active?: boolean; role?: string; passwordHash?: string } = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.role === "string" && ["ADMIN", "AGENT"].includes(body.role)) data.role = body.role;
  if (typeof body.password === "string" && body.password.length >= 8) {
    data.passwordHash = await hashPassword(body.password);
  }

  // vinculos por setor (F3): substitui o conjunto inteiro
  // (ADMIN nunca tem vinculos: ve tudo por papel)
  const sectorIds =
    Array.isArray(body.sectorIds) && body.role !== "ADMIN" && data.role !== "ADMIN"
      ? (body.sectorIds.filter((v: unknown) => typeof v === "string") as string[])
      : null;

  if (Object.keys(data).length === 0 && sectorIds === null) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }
  if (session.sub === id && data.active === false) {
    return NextResponse.json({ error: "Voce nao pode inativar o proprio cadastro." }, { status: 409 });
  }

  // os setores precisam existir (evita vinuclos orfaos)
  if (sectorIds && sectorIds.length > 0) {
    const found = await prisma.sector.count({
      where: { id: { in: sectorIds }, active: true },
    });
    if (found < sectorIds.length) {
      return NextResponse.json({ error: "Setor invalido na lista de vinculos." }, { status: 400 });
    }
  }

  const user = await prisma.$transaction(async (tx) => {
    if (sectorIds !== null) {
      await tx.sectorMembership.deleteMany({ where: { userId: id } });
      if (sectorIds.length > 0) {
        await tx.sectorMembership.createMany({
          data: sectorIds.map((sectorId) => ({ userId: id, sectorId })),
        });
      }
    }
    return tx.user.update({
      where: { id },
      data,
      select: {
        id: true, name: true, email: true, role: true, active: true,
        memberships: { select: { sectorId: true } },
      },
    });
  });
  return NextResponse.json(user);
}
