import { requireSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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

function dayKey(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireSession();
  if (session.role !== "ADMIN") redirect("/dashboard");

  const params = await searchParams;
  const range: Range = ["hoje", "7d", "30d"].includes(params.range ?? "")
    ? (params.range as Range)
    : "7d";
  const from = rangeStart(range);

  // ---- dados brutos (1 passada, agregacao em memoria) ----
  const conversationsInPeriod = await prisma.conversation.findMany({
    where: { createdAt: { gte: from } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      closedAt: true,
      assignedUserId: true,
      sector: { select: { name: true } },
      assignedUser: { select: { name: true } },
      messages: { select: { direction: true, createdAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const messagesInPeriod = await prisma.message.findMany({
    where: { createdAt: { gte: from } },
    select: { direction: true, createdAt: true },
  });

  // ---- KPIs ----
  const created = conversationsInPeriod.length;
  const closedInPeriod = conversationsInPeriod.filter(
    (c) => c.closedAt && c.closedAt >= from
  ).length;
  const incoming = messagesInPeriod.filter((m) => m.direction === "INCOMING").length;
  const outgoing = messagesInPeriod.filter((m) => m.direction === "OUTGOING").length;

  // tempo de 1a resposta: por conversa, 1a INCOMING -> 1a OUTGOING depois dela
  const replyDeltasMin: number[] = [];
  for (const c of conversationsInPeriod) {
    const sorted = [...c.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const firstIn = sorted.find((m) => m.direction === "INCOMING");
    if (!firstIn) continue;
    const firstOut = sorted.find(
      (m) => m.direction === "OUTGOING" && m.createdAt > firstIn.createdAt
    );
    if (!firstOut) continue;
    replyDeltasMin.push(
      (firstOut.createdAt.getTime() - firstIn.createdAt.getTime()) / 60000
    );
  }
  const avgFirstReplyMin =
    replyDeltasMin.length > 0
      ? Math.round(
          replyDeltasMin.reduce((a, b) => a + b, 0) / replyDeltasMin.length
        )
      : null;

  // ---- por setor (conversas criadas no periodo) ----
  const bySector = new Map<string, number>();
  for (const c of conversationsInPeriod) {
    const key = c.sector?.name ?? "Sem setor";
    bySector.set(key, (bySector.get(key) ?? 0) + 1);
  }

  // ---- por atendente (encerradas no periodo + atribuidas) ----
  const byAgent = new Map<
    string,
    { closed: number; assigned: number }
  >();
  for (const c of conversationsInPeriod) {
    if (!c.assignedUser) continue;
    const row = byAgent.get(c.assignedUser.name) ?? { closed: 0, assigned: 0 };
    if (c.closedAt && c.closedAt >= from) row.closed += 1;
    row.assigned += 1;
    byAgent.set(c.assignedUser.name, row);
  }

  // ---- grafico diario (mensagens do periodo, buckets por dia) ----
  const daily = new Map<string, { in: number; out: number }>();
  for (const m of messagesInPeriod) {
    const k = dayKey(m.createdAt);
    const row = daily.get(k) ?? { in: 0, out: 0 };
    if (m.direction === "INCOMING") row.in += 1;
    else row.out += 1;
    daily.set(k, row);
  }
  const maxDaily = Math.max(1, ...[...daily.values()].map((v) => v.in + v.out));

  const sectors = [...bySector.entries()].sort((a, b) => b[1] - a[1]);
  const agents = [...byAgent.entries()].sort((a, b) => b[1].closed - a[1].closed);
  const dailyRows = [...daily.entries()].sort(
    (a, b) =>
      a[0].split("/")[1].localeCompare(b[0].split("/")[1]) ||
      a[0].localeCompare(b[0])
  );

  const cards = [
    { label: "Conversas criadas", value: created, tone: "text-sky-600" },
    { label: "Encerradas no período", value: closedInPeriod, tone: "text-emerald-600" },
    {
      label: "1ª resposta (média)",
      value: avgFirstReplyMin === null ? "—" : `${avgFirstReplyMin} min`,
      tone: "text-amber-600",
    },
    { label: "Mensagens recebidas", value: incoming, tone: "text-slate-700" },
    { label: "Mensagens enviadas", value: outgoing, tone: "text-slate-700" },
  ];

  const ranges: { key: Range; label: string }[] = [
    { key: "hoje", label: "Hoje" },
    { key: "7d", label: "7 dias" },
    { key: "30d", label: "30 dias" },
  ];

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Relatórios</h1>

      {/* periodos */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {ranges.map((r) => (
          <a
            key={r.key}
            href={`/relatorios?range=${r.key}`}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              range === r.key
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {r.label}
          </a>
        ))}
        <a
          href={`/api/relatorios/export?range=${range}`}
          className="ml-auto rounded-md border border-emerald-600 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
          title="Baixar o relatorio deste periodo em CSV (abre no Excel)"
        >
          ⬇ Exportar CSV
        </a>
      </div>

      {/* KPIs */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">{c.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* grafico diario */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Volume diário de mensagens</h2>
          {dailyRows.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">Sem mensagens no período.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {dailyRows.map(([day, v]) => (
                <div key={day} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-right text-xs text-slate-500">{day}</span>
                  <div className="flex flex-1 gap-0.5">
                    <div
                      className="h-4 rounded-l bg-slate-300"
                      style={{ width: `${(v.in / maxDaily) * 70}%` }}
                      title={`${v.in} recebidas`}
                    />
                    <div
                      className="h-4 rounded-r bg-emerald-400"
                      style={{ width: `${(v.out / maxDaily) * 70}%` }}
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
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Conversas por setor</h2>
          {sectors.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">Sem conversas no período.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="pb-1">Setor</th>
                  <th className="pb-1 text-right">Conversas</th>
                </tr>
              </thead>
              <tbody>
                {sectors.map(([name, n]) => (
                  <tr key={name} className="border-t border-slate-100">
                    <td className="py-1.5">{name}</td>
                    <td className="py-1.5 text-right font-medium">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* por atendente */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Por atendente (encerradas / atualmente atribuídas*)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            * mensagens enviadas historicamente não guardam o autor; a atribuição usa o
            atendente responsável pela conversa no momento.
          </p>
          {agents.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">Nenhum atendente com conversas no período.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="pb-1">Atendente</th>
                  <th className="pb-1 text-right">Encerradas no período</th>
                  <th className="pb-1 text-right">Atribuídas</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(([name, row]) => (
                  <tr key={name} className="border-t border-slate-100">
                    <td className="py-1.5">{name}</td>
                    <td className="py-1.5 text-right">{row.closed}</td>
                    <td className="py-1.5 text-right">{row.assigned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
