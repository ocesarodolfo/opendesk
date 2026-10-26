import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

// Renomeia / recolor etiqueta global (apenas ADMIN)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores editam etiquetas." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { name?: string; color?: string } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 40);
    if (!name) return NextResponse.json({ error: "Nome vazio." }, { status: 400 });
    data.name = name;
  }
  if (typeof body.color === "string" && ["slate", "emerald", "sky", "amber", "rose", "violet"].includes(body.color)) {
    data.color = body.color;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  try {
    const tag = await prisma.tag.update({
      where: { id },
      data,
      select: { id: true, name: true, color: true },
    });
    void auditLog({
      action: AUDIT_ACTIONS.ETIQUETA_ATUALIZADA,
      entity: "Tag",
      entityId: id,
      detail: `"${tag.name}" cor ${tag.color}`,
      session,
      req,
    });
    return NextResponse.json(tag);
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: string }).code : "";
    if (code === "P2025") return NextResponse.json({ error: "Etiqueta inexistente." }, { status: 404 });
    if (code === "P2002") {
      return NextResponse.json({ error: "Ja existe uma etiqueta com esse nome." }, { status: 409 });
    }
    console.error("[tags] PATCH falhou:", error);
    return NextResponse.json({ error: "Nao foi possivel salvar." }, { status: 500 });
  }
}

// Exclui etiqueta global (apenas ADMIN) — desvincula dos contatos automaticamente
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores excluem etiquetas." }, { status: 403 });
  }

  const { id } = await params;
  try {
    await prisma.tag.delete({ where: { id } });
    void auditLog({
      action: AUDIT_ACTIONS.ETIQUETA_EXCLUIDA,
      entity: "Tag",
      entityId: id,
      session,
      req,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: string }).code === "P2025"
    ) {
      return NextResponse.json({ error: "Etiqueta inexistente." }, { status: 404 });
    }
    console.error("[tags] DELETE falhou:", error);
    return NextResponse.json({ error: "Nao foi possivel excluir." }, { status: 500 });
  }
}
