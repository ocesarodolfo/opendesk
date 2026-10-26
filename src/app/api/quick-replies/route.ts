import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getSectorScope, type SectorScope } from "@/lib/scope";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

// Respostas rapidas: lista para uso no inbox.
// AGENT ve as ativas de nivel empresa + dos seus setores; ADMIN ve tudo.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1" && session.role === "ADMIN";

  const scope: SectorScope = await getSectorScope(session);
  const where = all
    ? {}
    : {
        active: true,
        OR:
          scope.kind === "ALL"
            ? undefined
            : [{ sectorId: null }, { sectorId: { in: scope.kind === "LIST" ? scope.sectorIds : [] } }],
      };

  const replies = await prisma.quickReply.findMany({
    where,
    include: { sector: true },
    orderBy: { shortcut: "asc" },
  });
  return NextResponse.json(
    replies.map((r) => ({
      id: r.id,
      shortcut: r.shortcut,
      content: r.content,
      active: r.active,
      sectorId: r.sectorId,
      sectorName: r.sector?.name ?? null,
    }))
  );
}

// Criar resposta rapida (ADMIN)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const shortcut = typeof body.shortcut === "string" ? body.shortcut.trim().slice(0, 60) : "";
  const content = typeof body.content === "string" ? body.content.trim().slice(0, 4096) : "";
  const sectorId = body.sectorId === null || typeof body.sectorId === "string" ? body.sectorId : null;

  if (!shortcut) {
    return NextResponse.json({ error: "Atalho obrigatorio." }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "Conteudo obrigatorio." }, { status: 400 });
  }
  if (sectorId) {
    const sector = await prisma.sector.findUnique({
      where: { id: sectorId },
      select: { id: true, active: true },
    });
    if (!sector?.active) {
      return NextResponse.json({ error: "Setor invalido." }, { status: 400 });
    }
  }

  const reply = await prisma.quickReply.create({
    data: { shortcut, content, sectorId },
  });
  void auditLog({
    action: AUDIT_ACTIONS.RESPOSTA_CRIADA,
    entity: "QuickReply",
    entityId: reply.id,
    detail: `"/${shortcut}" (setor: ${sectorId ?? "empresa"})`,
    session,
    req,
  });
  return NextResponse.json(reply, { status: 201 });
}
