import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getReportData, parseReportFilters } from "@/lib/reports";

// ---------------------------------------------------------------------------
// Export CSV dos relatorios (mesmas metricas e filtros da pagina /relatorios).
// Um unico arquivo com secoes: KPIs, Volume diario, Por setor, Por atendente.
// BOM no inicio para o Excel abrir UTF-8 corretamente.
// ---------------------------------------------------------------------------

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

  const sp = req.nextUrl.searchParams;
  const filters = parseReportFilters({
    range: sp.get("range"),
    from: sp.get("from"),
    to: sp.get("to"),
    sectorId: sp.get("sectorId"),
    numberId: sp.get("numberId"),
    agentId: sp.get("agentId"),
    status: sp.get("status"),
  });

  const data = await getReportData(filters);

  const lines: string[] = [];
  lines.push(
    `Relatorio de atendimento;periodo=${filters.range};gerado em=${new Date().toLocaleString("pt-BR")}`
  );
  lines.push("");
  lines.push("KPIs");
  lines.push("Metrica;Valor");
  lines.push(`Conversas criadas;${data.created}`);
  lines.push(`Conversas encerradas no periodo;${data.closedInPeriod}`);
  lines.push(`1a resposta media (min);${data.avgFirstReplyMin ?? "-"}`);
  lines.push(`Mensagens recebidas;${data.incoming}`);
  lines.push(`Mensagens enviadas;${data.outgoing}`);
  lines.push("");
  lines.push("Volume diario de mensagens");
  lines.push("Dia;Recebidas;Enviadas");
  for (const [day, v] of data.dailyRows) {
    lines.push(`${day};${v.in};${v.out}`);
  }
  lines.push("");
  lines.push("Conversas por setor");
  lines.push("Setor;Conversas");
  for (const [name, n] of data.sectors) {
    lines.push(`${csvCell(name)};${n}`);
  }
  lines.push("");
  lines.push("Por atendente");
  lines.push("Atendente;Encerradas no periodo;Atribuidas");
  for (const [name, row] of data.agents) {
    lines.push(`${csvCell(name)};${row.closed};${row.assigned}`);
  }

  const body = "\uFEFF" + lines.join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relatorio-${filters.range}-${stamp}.csv"`,
    },
  });
}
