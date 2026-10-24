import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Renomear contato (atendentes e admin; o nome padrao e o pushName do WhatsApp)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  // null = apagar o nome editado e voltar a usar o pushName
  const name =
    body.name === null
      ? null
      : typeof body.name === "string"
        ? body.name.trim().slice(0, 120) || null
        : undefined;

  // etiquetas: array de tagIds substitui o conjunto atual do contato
  const tagIds = Array.isArray(body.tagIds)
    ? body.tagIds.filter((t: unknown): t is string => typeof t === "string")
    : undefined;

  if (name === undefined && tagIds === undefined) {
    return NextResponse.json({ error: "Envie o campo name ou tagIds." }, { status: 400 });
  }

  try {
    const contact = await prisma.contact.update({
      where: { id },
      data: {
        name: name as string | null | undefined,
        ...(tagIds !== undefined
          ? {
              tags: {
                deleteMany: {},
                create: tagIds.map((tagId: string) => ({ tagId })),
              },
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        pushName: true,
        isGroup: true,
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      },
    });
    return NextResponse.json({
      ...contact,
      tags: contact.tags.map((t) => t.tag),
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: string }).code === "P2025"
    ) {
      return NextResponse.json({ error: "Contato inexistente." }, { status: 404 });
    }
    console.error("[contacts] PATCH falhou:", error);
    return NextResponse.json({ error: "Nao foi possivel salvar o contato." }, { status: 500 });
  }
}
