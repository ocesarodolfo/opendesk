import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Mensagem generica: nao revela se o e-mail existe
  if (!user || !user.active) {
    return NextResponse.json({ error: "Credenciais invalidas." }, { status: 401 });
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    return NextResponse.json({ error: "Credenciais invalidas." }, { status: 401 });
  }

  await createSession({ sub: user.id, name: user.name, role: user.role === "ADMIN" ? "ADMIN" : "AGENT" });
  return NextResponse.json({ ok: true });
}
