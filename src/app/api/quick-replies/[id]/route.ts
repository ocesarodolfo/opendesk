import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

function isNotFound(error: unknown) {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "P2025";
}

async function guardAdmin() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Nao autenticado" }, { status: 401 }) };
  if (session.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Apenas administradores." }, { status: 403 }) };
  }
  return { session };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await guardAdmin();
  if (guard.error) return guard.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { shortcut?: string; content?: string; active?: boolean; sectorId?: string | null } = {};
  if (typeof body.shortcut === "string") data.shortcut = body.shortcut.trim().slice(0, 60);
  if (typeof body.content === "string") data.content = body.content.trim().slice(0, 4096);
  if (body.sectorId === null || typeof body.sectorId === "string") data.sectorId = body.sectorId;
  if (typeof body.active === "boolean") data.active = body.active;
  if (data.shortcut === "" || data.content === "") {
    return NextResponse.json({ error: "Atalho/conteudo nao podem ficar vazios." }, { status: 400 });
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  try {
    return NextResponse.json(await prisma.quickReply.update({ where: { id }, data }));
  } catch (error) {
    if (isNotFound(error)) {
      return NextResponse.json({ error: "Resposta inexistente." }, { status: 404 });
    }
    console.error("[quick-replies] PATCH falhou:", error);
    return NextResponse.json({ error: "Nao foi possivel salvar." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await guardAdmin();
  if (guard.error) return guard.error;

  const { id } = await params;
  try {
    await prisma.quickReply.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isNotFound(error)) {
      return NextResponse.json({ error: "Resposta inexistente." }, { status: 404 });
    }
    console.error("[quick-replies] DELETE falhou:", error);
    return NextResponse.json({ error: "Nao foi possivel excluir." }, { status: 500 });
  }
}
