import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { waManager } from "@/lib/whatsapp/manager";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

// Aplica o status "ao vivo" da sessao (manager) sobre o registrato no banco:
// apos um restart do processo, CONNECTED no banco e stale ate a retomada.
function mergeStatus(
  dbStatus: string,
  live: { status: string; qr: string | null; phone: string | null }
): string {
  if (live.status !== "DISCONNECTED") return live.status;
  return dbStatus === "CONNECTED" ? "DISCONNECTED" : dbStatus;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const numbers = await prisma.whatsAppNumber.findMany({
    orderBy: { createdAt: "asc" },
    include: { sector: { select: { name: true } } },
  });

  return NextResponse.json(
    numbers.map((n) => {
      const live = waManager.getStatus(n.id);
      return {
        id: n.id,
        label: n.label,
        phone: live.phone ?? n.phone,
        status: mergeStatus(n.status, live),
        lastError: n.lastError,
        sectorId: n.sectorId,
        sectorName: n.sector?.name ?? null,
      };
    })
  );
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const sectorId = typeof body.sectorId === "string" && body.sectorId ? body.sectorId : null;

  if (!label) return NextResponse.json({ error: "Informe o nome/identificacao do numero." }, { status: 400 });

  if (sectorId) {
    const sector = await prisma.sector.findUnique({ where: { id: sectorId } });
    if (!sector) return NextResponse.json({ error: "Setor inexistente." }, { status: 400 });
  }

  const whatsAppNumber = await prisma.whatsAppNumber.create({
    data: { label, sectorId, status: "DISCONNECTED" },
  });

  void auditLog({
    action: AUDIT_ACTIONS.NUMERO_CRIADO,
    entity: "WhatsAppNumber",
    entityId: whatsAppNumber.id,
    detail: `"${label}"`,
    session,
    req,
  });

  return NextResponse.json(
    {
      id: whatsAppNumber.id,
      label: whatsAppNumber.label,
      phone: whatsAppNumber.phone,
      status: whatsAppNumber.status,
      lastError: null,
      sectorId: whatsAppNumber.sectorId,
      sectorName: null,
    },
    { status: 201 }
  );
}
