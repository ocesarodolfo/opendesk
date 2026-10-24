import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Lista todas as etiquetas (qualquer usuario autenticado — usadas na Inbox)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
  });
  return NextResponse.json(tags);
}

// Cria etiqueta global (apenas ADMIN)
const COLORS = ["slate", "emerald", "sky", "amber", "rose", "violet"];
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores criam etiquetas." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  const color = COLORS.includes(body.color) ? body.color : "slate";
  if (!name) return NextResponse.json({ error: "Informe o nome da etiqueta." }, { status: 400 });

  try {
    const tag = await prisma.tag.create({ data: { name, color } });
    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json({ error: "Ja existe uma etiqueta com esse nome." }, { status: 409 });
    }
    console.error("[tags] POST falhou:", error);
    return NextResponse.json({ error: "Nao foi possivel criar a etiqueta." }, { status: 500 });
  }
}
