import { requireSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { IconDownload } from "@/components/icons";
import {
  buildReportQueryString,
  getReportData,
  parseReportFilters,
  type ReportRange,
} from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    sectorId?: string;
    numberId?: string;
    agentId?: string;
    status?: string;
  }>;
}) {
  const session = await requireSession();
  if (session.role !== "ADMIN") redirect("/dashboard");

  const params = await searchParams;
  const filters = parseReportFilters(params);

  const [data, sectorOptions, numberOptions, agentOptions] = await Promise.all([
    getReportData(filters),
    prisma.sector.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.whatsAppNumber.findMany({
      orderBy: { label: "asc" },
      select: { id: true, label: true, phone: true },
    }),
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const cards = [
    { label: "Conversas criadas", value: data.created, tone: "text-sky-600" },
    { label: "Encerradas no período", value: data.closedInPeriod, tone: "text-emerald-600" },
    {
      label: "1ª resposta (média)",
      value: data.avgFirstReplyMin === null ? "—" : `${data.avgFirstReplyMin} min`,
      tone: "text-amber-600",
    },
    { label: "Mensagens recebidas", value: data.incoming, tone: "text-slate-700" },
    { label: "Mensagens enviadas", value: data.outgoing, tone: "text-slate-700" },
  ];

  const ranges: { key: Exclude<ReportRange, "custom">; label: string }[] = [
    { key: "hoje", label: "Hoje" },
    { key: "7d", label: "7 dias" },
    { key: "30d", label: "30 dias" },
  ];

  const hasExtraFilters = Boolean(
    filters.range === "custom" ||
      filters.sectorId ||
      filters.numberId ||
      filters.agentId ||
      filters.status
  );

  const exportQuery = buildReportQueryString(filters);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Relatórios</h1>
      <p className="mt-1 text-sm text-slate-500">
        Indicadores de volume, tempo de primeira resposta e desempenho por setor e atendente.
      </p>

      <div className="mt-6 space-y-6">
        {/* Filtros */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {ranges.map((r) => {
              const q = buildReportQueryString({ ...filters, range: r.key, from: "", to: "" });
              return (
                <a
                  key={r.key}
                  href={`/relatorios?${q}`}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                    filters.range === r.key
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {r.label}
                </a>
              );
            })}
            <a
              href={`/api/relatorios/export?${exportQuery}`}
              className="ml-auto flex items-center gap-1.5 rounded-md border border-emerald-600 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
              title="Baixar o relatório deste período em CSV (abre no Excel)"
            >
              <IconDownload className="h-4 w-4" /> Exportar CSV
            </a>
          </div>

          <form
            method="GET"
            action="/relatorios"
            className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-6"
          >
            <input type="hidden" name="range" value={filters.range === "custom" ? "custom" : filters.range} />
            <div>
              <label className="block text-xs font-medium text-slate-600">De (personalizado)</label>
              <input
                type="date"
                name="from"
                defaultValue={filters.from}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Até (personalizado)</label>
              <input
                type="date"
                name="to"
                defaultValue={filters.to}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Setor</label>
              <select
                name="sectorId"
                defaultValue={filters.sectorId}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
              >
                <option value="">Todos</option>
                <option value="__none__">Sem setor</option>
                {sectorOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Número WhatsApp</label>
              <select
                name="numberId"
                defaultValue={filters.numberId}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
              >
                <option value="">Todos</option>
                {numberOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Atendente</label>
              <select
                name="agentId"
                defaultValue={filters.agentId}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
              >
                <option value="">Todos</option>
                <option value="__unassigned__">Não atribuídas</option>
                {agentOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Status</label>
              <select
                name="status"
                defaultValue={filters.status}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
              >
                <option value="">Todos</option>
                <option value="OPEN">Aberto</option>
                <option value="PENDING">Pendente</option>
                <option value="CLOSED">Encerrado</option>
              </select>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-6">
              <button
                type="submit"
                className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
              >
                Aplicar filtros
              </button>
              {hasExtraFilters && (
                <a
                  href="/relatorios?range=7d"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Limpar filtros
                </a>
              )}
            </div>
          </form>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
              <p className={`mt-2 text-2xl font-bold ${c.tone}`}>{c.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* grafico diario */}
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">Volume diário de mensagens</h2>
            {data.dailyRows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Sem mensagens no período.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {data.dailyRows.map(([day, v]) => (
                  <div key={day} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-right text-xs text-slate-500">{day}</span>
                    <div className="flex flex-1 gap-0.5">
                      <div
                        className="h-4 rounded-l bg-slate-300"
                        style={{ width: `${(v.in / data.maxDaily) * 70}%` }}
                        title={`${v.in} recebidas`}
                      />
                      <div
                        className="h-4 rounded-r bg-emerald-400"
                        style={{ width: `${(v.out / data.maxDaily) * 70}%` }}
                        title={`${v.out} enviadas`}
                      />
                      <span className="text-xs text-slate-500">
                        {v.in}↓ / {v.out}↑
                      </span>
                    </div>
                  </div>
                ))}
                <p className="pt-2 text-xs text-slate-400">
                  <span className="font-semibold text-slate-500">cinza</span> = recebidas ·{" "}
                  <span className="font-semibold text-emerald-500">verde</span> = enviadas
                </p>
              </div>
            )}
          </section>

          {/* por setor */}
          <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Conversas por setor</h2>
            </div>
            {data.sectors.length === 0 ? (
              <p className="p-4 text-sm text-slate-400">Sem conversas no período.</p>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Setor</th>
                    <th className="px-4 py-2 text-right">Conversas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.sectors.map(([name, n]) => (
                    <tr key={name}>
                      <td className="px-4 py-2 font-medium">{name}</td>
                      <td className="px-4 py-2 text-right font-medium text-slate-600">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* por atendente */}
          <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm lg:col-span-2">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">
                Por atendente (encerradas / atualmente atribuídas*)
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                * mensagens enviadas historicamente não guardam o autor; a atribuição usa o
                atendente responsável pela conversa no momento.
              </p>
            </div>
            {data.agents.length === 0 ? (
              <p className="p-4 text-sm text-slate-400">Nenhum atendente com conversas no período.</p>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Atendente</th>
                    <th className="px-4 py-2 text-right">Encerradas no período</th>
                    <th className="px-4 py-2 text-right">Atribuídas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.agents.map(([name, row]) => (
                    <tr key={name}>
                      <td className="px-4 py-2 font-medium">{name}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{row.closed}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{row.assigned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
