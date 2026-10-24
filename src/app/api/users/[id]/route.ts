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
  // Papel por vinculo (F3-1): SUPERVISOR no setor tem atribuicao em lote.
  type MembershipDraft = { sectorId: string; role: string };
  let memberships: MembershipDraft[] | null = null;

  if (Array.isArray(body.membershipRoles) && body.role !== "ADMIN" && data.role !== "ADMIN") {
    const drafts = (body.membershipRoles as unknown[])
      .filter(
        (m): m is { sectorId: string; role: string } =>
          !!m && typeof (m as { sectorId?: string }).sectorId === "string" &&
          (["AGENT", "SUPERVISOR"] as string[]).includes(
            (m as { role?: string }).role ?? "AGENT"
          )
      )
      .map((m) => ({ sectorId: m.sectorId, role: m.role ?? "AGENT" }));
    // sem setorId duplicado (mantem o ultimo papel declarado)
    const map = new Map(drafts.map((m) => [m.sectorId, m.role]));
    memberships = [...map.entries()].map(([sectorId, role]) => ({ sectorId, role }));
  } else if (Array.isArray(body.sectorIds) && body.role !== "ADMIN" && data.role !== "ADMIN") {
    memberships = (body.sectorIds as unknown[]).map((sectorId) =>
      typeof sectorId === "string" ? { sectorId, role: "AGENT" } : null
    ) as MembershipDraft[] | null;
    if (memberships && memberships.some((m) => m === null)) memberships = null;
  }

  if (Object.keys(data).length === 0 && memberships === null) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }
  if (session.sub === id && data.active === false) {
    return NextResponse.json({ error: "Voce nao pode inativar o proprio cadastro." }, { status: 409 });
  }

  // os setores precisam existir (evita vinculos orfaos)
  if (memberships && memberships.length > 0) {
    const found = await prisma.sector.count({
      where: { id: { in: memberships.map((m) => m.sectorId) }, active: true },
    });
    if (found < memberships.length) {
      return NextResponse.json({ error: "Setor invalido na lista de vinculos." }, { status: 400 });
    }
  }

  const user = await prisma.$transaction(async (tx) => {
    if (memberships !== null) {
      await tx.sectorMembership.deleteMany({ where: { userId: id } });
      if (memberships.length > 0) {
        await tx.sectorMembership.createMany({
          data: memberships.map((m) => ({ userId: id, sectorId: m.sectorId, role: m.role })),
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
