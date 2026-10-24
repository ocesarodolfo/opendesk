import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, active: true,
      memberships: { select: { sector: { select: { id: true, name: true } } } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      sectors: u.memberships.map((m) => ({ id: m.sector.id, name: m.sector.name })),
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = body.role === "ADMIN" ? "ADMIN" : "AGENT";

  if (!name || !email || password.length < 8) {
    return NextResponse.json(
      { error: "Preencha nome, e-mail e senha (minimo 8 caracteres)." },
      { status: 400 }
    );
  }

  try {
    const user = await prisma.user.create({
      data: { name, email, passwordHash: await hashPassword(password), role },
    });
    return NextResponse.json(
      { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "E-mail ja cadastrado." }, { status: 409 });
  }
}
