import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword, verifyPassword } from "@/lib/auth";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

// Troca a propria senha (usuario logado), exigindo a senha atual
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (newPassword.length < 8) {
    return NextResponse.json({ error: "A nova senha precisa ter ao menos 8 caracteres." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user || !user.active) {
    return NextResponse.json({ error: "Usuario invalido." }, { status: 401 });
  }

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    return NextResponse.json({ error: "Senha atual incorreta." }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  void auditLog({
    action: AUDIT_ACTIONS.SENHA_TROCA,
    entity: "User",
    entityId: user.id,
    detail: `troca da propria senha: ${user.name} <${user.email}>`,
    session,
    req,
  });

  return NextResponse.json({ ok: true });
}
