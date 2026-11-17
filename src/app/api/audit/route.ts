import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

function parseDateStart(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateEnd(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function csvCell(v: string | null | undefined): string {
  const s = (v ?? "").replace(/\r?\n/g, " ");
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const action = sp.get("action")?.trim() || "";
  const entity = sp.get("entity")?.trim() || "";
  const actorId = sp.get("actorId")?.trim() || "";
  const q = sp.get("q")?.trim() || "";
  const from = parseDateStart(sp.get("from"));
  const to = parseDateEnd(sp.get("to"));
  const format = sp.get("format");

  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(10, Number.parseInt(sp.get("limit") ?? "50", 10) || 50));

  const where: Prisma.AuditLogWhereInput = {};
  if (action) where.action = action;
  if (entity) where.entity = entity;
  if (actorId === "__system__") {
    where.actorId = null;
  } else if (actorId) {
    where.actorId = actorId;
  }
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (q) {
    where.OR = [
      { detail: { contains: q } },
      { actorName: { contains: q } },
      { entityId: { contains: q } },
      { ip: { contains: q } },
      { action: { contains: q } },
    ];
  }

  if (format === "csv") {
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 2000,
    });
    const header = ["Data/Hora", "Ator", "Acao", "Entidade", "ID Entidade", "Detalhe", "IP", "Metadata"]
      .map(csvCell)
      .join(",");
    const lines = rows.map((r) =>
      [
        r.createdAt.toISOString(),
        r.actorName ?? "Sistema",
        r.action,
        r.entity,
        r.entityId ?? "",
        r.detail ?? "",
        r.ip ?? "",
        r.metadata ?? "",
      ]
        .map(csvCell)
        .join(",")
    );
    const csv = `\uFEFF${[header, ...lines].join("\r\n")}`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const [total, items, users] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    actors: users,
  });
}

