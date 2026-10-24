import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Export CSV dos relatorios (mesmas metricas da pagina /relatorios).
// Um unico arquivo com secoes: KPIs, Volume diario, Por setor, Por atendente.
// BOM no inicio para o Excel abrir UTF-8 corretamente.
// ---------------------------------------------------------------------------
type Range = "hoje" | "7d" | "30d";

function rangeStart(range: Range): Date {
  if (range === "hoje") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const days = range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// mascara valor de forma que o Excel PT-BR nao quebre em colunas/json
function csvCell(value: string | number | null): string {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores exportam relatorios." }, { status: 403 });
  }

  const rangeParam = req.nextUrl.searchParams.get("range") ?? "7d";
  const range: Range = ["hoje", "7d", "30d"].includes(rangeParam) ? (rangeParam as Range) : "7d";
  const from = rangeStart(range);

  const conversationsInPeriod = await prisma.conversation.findMany({
    where: { createdAt: { gte: from } },
    select: {
      closedAt: true,
      assignedUserId: true,
      sector: { select: { name: true } },
      assignedUser: { select: { name: true } },
      messages: { select: { direction: true, createdAt: true } },
    },
  });

  const messagesInPeriod = await prisma.message.findMany({
    where: { createdAt: { gte: from } },
    select: { direction: true, createdAt: true },
  });

  const created = conversationsInPeriod.length;
  const closedInPeriod = conversationsInPeriod.filter((c) => c.closedAt && c.closedAt >= from).length;
  const incoming = messagesInPeriod.filter((m) => m.direction === "INCOMING").length;
  const outgoing = messagesInPeriod.filter((m) => m.direction === "OUTGOING").length;

  const replyDeltasMin: number[] = [];
  for (const c of conversationsInPeriod) {
    const sorted = [...c.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const firstIn = sorted.find((m) => m.direction === "INCOMING");
    if (!firstIn) continue;
    const firstOut = sorted.find((m) => m.direction === "OUTGOING" && m.createdAt > firstIn.createdAt);
    if (!firstOut) continue;
    replyDeltasMin.push((firstOut.createdAt.getTime() - firstIn.createdAt.getTime()) / 60000);
  }
  const avgFirstReplyMin =
    replyDeltasMin.length > 0
      ? Math.round(replyDeltasMin.reduce((a, b) => a + b, 0) / replyDeltasMin.length)
      : null;

  const daily = new Map<string, { in: number; out: number }>();
  for (const m of messagesInPeriod) {
    const k = m.createdAt.toLocaleDateString("pt-BR");
    const row = daily.get(k) ?? { in: 0, out: 0 };
    if (m.direction === "INCOMING") row.in += 1;
    else row.out += 1;
    daily.set(k, row);
  }

  const bySector = new Map<string, number>();
  for (const c of conversationsInPeriod) {
    const key = c.sector?.name ?? "Sem setor";
    bySector.set(key, (bySector.get(key) ?? 0) + 1);
  }

  const byAgent = new Map<string, { closed: number; assigned: number }>();
  for (const c of conversationsInPeriod) {
    if (!c.assignedUser) continue;
    const row = byAgent.get(c.assignedUser.name) ?? { closed: 0, assigned: 0 };
    if (c.closedAt && c.closedAt >= from) row.closed += 1;
    row.assigned += 1;
    byAgent.set(c.assignedUser.name, row);
  }

  const lines: string[] = [];
  lines.push(`Relatorio de atendimento;periodo=${range};gerado em=${new Date().toLocaleString("pt-BR")}`);
  lines.push("");
  lines.push("KPIs");
  lines.push("Metrica;Valor");
  lines.push(`Conversas criadas;${created}`);
  lines.push(`Conversas encerradas no periodo;${closedInPeriod}`);
  lines.push(`1a resposta media (min);${avgFirstReplyMin ?? "-"}`);
  lines.push(`Mensagens recebidas;${incoming}`);
  lines.push(`Mensagens enviadas;${outgoing}`);
  lines.push("");
  lines.push("Volume diario de mensagens");
  lines.push("Dia;Recebidas;Enviadas");
  for (const [day, v] of [...daily.entries()].sort()) {
    lines.push(`${day};${v.in};${v.out}`);
  }
  lines.push("");
  lines.push("Conversas por setor");
  lines.push("Setor;Conversas");
  for (const [name, n] of [...bySector.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`${csvCell(name)};${n}`);
  }
  lines.push("");
  lines.push("Por atendente");
  lines.push("Atendente;Encerradas no periodo;Atribuidas");
  for (const [name, row] of [...byAgent.entries()].sort((a, b) => b[1].closed - a[1].closed)) {
    lines.push(`${csvCell(name)};${row.closed};${row.assigned}`);
  }

  const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relatorio-${range}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
