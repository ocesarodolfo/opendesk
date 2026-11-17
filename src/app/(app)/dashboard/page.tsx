import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { conversationVisibilityFilter, getSectorScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

type DashRange = "hoje" | "7d" | "30d" | "tudo";

function parseRange(raw?: string): DashRange {
  if (raw === "hoje" || raw === "7d" || raw === "30d" || raw === "tudo") return raw;
  return "hoje";
}

function rangeStart(range: DashRange): Date | null {
  if (range === "tudo") return null;
  if (range === "hoje") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const days = range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const VALID_STATUSES = new Set(["OPEN", "PENDING", "CLOSED"]);

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    sectorId?: string;
    numberId?: string;
    status?: string;
    q?: string;
  }>;
}) {
  const session = await requireSession();
  const scope = await getSectorScope(session);
  // escopo por setor (F3): contagens e ultimas conversas respeitam o que
  // o usuario pode ver (ADMIN: tudo; agente: seus setores + numeros sem setor)
  const visibility = conversationVisibilityFilter(scope);

  const params = await searchParams;
  const range = parseRange(params.range);
  const sectorId = (params.sectorId ?? "").trim();
  const numberId = (params.numberId ?? "").trim();
  const status = VALID_STATUSES.has(params.status ?? "") ? (params.status as string) : "";
  const q = (params.q ?? "").trim();
  const periodFrom = rangeStart(range);

  // Opcoes de filtros respeitando o escopo do usuario
  const [sectorOptions, numberOptions] = await Promise.all([
    prisma.sector.findMany({
      where: scope.kind === "ALL" ? undefined : { id: { in: scope.sectorIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.whatsAppNumber.findMany({
      where:
        scope.kind === "ALL"
          ? undefined
          : {
              OR: [{ sectorId: { in: scope.sectorIds } }, { sectorId: null }],
            },
      orderBy: { label: "asc" },
      select: { id: true, label: true },
    }),
  ]);

  // Filtro base (visibilidade + setor/numero/busca selecionados)
  const baseWhere: Prisma.ConversationWhereInput = { ...visibility };
  if (sectorId === "__none__") baseWhere.sectorId = null;
  else if (sectorId) baseWhere.sectorId = sectorId;
  if (numberId) baseWhere.whatsappNumberId = numberId;
  if (q) {
    baseWhere.contact = {
      OR: [{ name: { contains: q } }, { phone: { contains: q } }],
    };
  }

  const listWhere: Prisma.ConversationWhereInput = {
    ...baseWhere,
    ...(status ? { status } : {}),
    ...(periodFrom ? { lastMessageAt: { gte: periodFrom } } : {}),
  };

  const numberWhere: Prisma.WhatsAppNumberWhereInput = {
    ...(sectorId === "__none__"
      ? { sectorId: null }
      : sectorId
        ? { sectorId }
        : scope.kind === "ALL"
          ? {}
          : { OR: [{ sectorId: { in: scope.sectorIds } }, { sectorId: null }] }),
    ...(numberId ? { id: numberId } : {}),
  };

  const closedLabel =
    range === "hoje"
      ? "Encerradas hoje"
      : range === "7d"
        ? "Encerradas (7d)"
        : range === "30d"
          ? "Encerradas (30d)"
          : "Encerradas (total)";

  const [openCount, pendingCount, closedInPeriod, connectedNumbers, totalNumbers, contacts, recent] =
    await Promise.all([
      prisma.conversation.count({
        where: { AND: [baseWhere, { status: "OPEN" }] },
      }),
      prisma.conversation.count({
        where: { AND: [baseWhere, { status: "PENDING" }] },
      }),
      prisma.conversation.count({
        where: {
          AND: [
            baseWhere,
            { status: "CLOSED" },
            ...(periodFrom ? [{ lastMessageAt: { gte: periodFrom } }] : []),
          ],
        },
      }),
      prisma.whatsAppNumber.count({ where: { ...numberWhere, status: "CONNECTED" } }),
      prisma.whatsAppNumber.count({ where: numberWhere }),
      prisma.contact.count(),
      prisma.conversation.findMany({
        where: listWhere,
        orderBy: { lastMessageAt: "desc" },
        take: 10,
        include: { contact: true, sector: true, whatsappNumber: true, assignedUser: true },
      }),
    ]);

  const cards = [
    { label: "Em atendimento (OPEN)", value: openCount, tone: "text-emerald-600" },
    { label: "Aguardando (PENDING)", value: pendingCount, tone: "text-amber-600" },
    { label: closedLabel, value: closedInPeriod, tone: "text-slate-700" },
    { label: "Números conectados", value: `${connectedNumbers}/${totalNumbers}`, tone: "text-sky-600" },
    { label: "Contatos cadastrados", value: contacts, tone: "text-slate-700" },
  ];

  const hasFilters = Boolean(range !== "hoje" || sectorId || numberId || status || q);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">
        Visão geral dos atendimentos, números conectados e conversas recentes.
      </p>

      <div className="mt-6 space-y-6">
        {/* Filtros */}
        <form
          method="GET"
          action="/dashboard"
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-600">Busca (contato)</label>
              <input
                name="q"
                defaultValue={q}
                placeholder="Nome ou telefone..."
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Período</label>
              <select
                name="range"
                defaultValue={range}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
              >
                <option value="hoje">Hoje</option>
                <option value="7d">Últimos 7 dias</option>
                <option value="30d">Últimos 30 dias</option>
                <option value="tudo">Todo o período</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Setor</label>
              <select
                name="sectorId"
                defaultValue={sectorId}
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
                defaultValue={numberId}
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
              <label className="block text-xs font-medium text-slate-600">Status</label>
              <select
                name="status"
                defaultValue={status}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
              >
                <option value="">Todos</option>
                <option value="OPEN">Aberto</option>
                <option value="PENDING">Pendente</option>
                <option value="CLOSED">Encerrado</option>
              </select>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="submit"
              className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
            >
              Aplicar filtros
            </button>
            {hasFilters && (
              <a
                href="/dashboard"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Limpar filtros
              </a>
            )}
          </div>
        </form>

        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {cards.map((card) => (
            <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
              <p className={`mt-2 text-2xl font-bold ${card.tone}`}>{card.value}</p>
            </div>
          ))}
        </div>

        {/* Últimas conversas */}
        <div>
          <h2 className="text-lg font-semibold">Últimas conversas</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Contato</th>
                  <th className="px-4 py-2">Número</th>
                  <th className="px-4 py-2">Setor</th>
                  <th className="px-4 py-2">Atendente</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Última mensagem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                      Nenhuma conversa encontrada para os filtros selecionados.
                    </td>
                  </tr>
                )}
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 font-medium">{c.contact.name ?? c.contact.phone}</td>
                    <td className="px-4 py-2 text-slate-600">{c.whatsappNumber.label}</td>
                    <td className="px-4 py-2 text-slate-600">{c.sector?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{c.assignedUser?.name ?? "—"}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      {c.lastMessageAt.toLocaleString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    OPEN: "bg-emerald-100 text-emerald-700",
    PENDING: "bg-amber-100 text-amber-700",
    CLOSED: "bg-slate-100 text-slate-600",
  };
  const labels: Record<string, string> = {
    OPEN: "Aberto",
    PENDING: "Pendente",
    CLOSED: "Encerrado",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? ""}`}>
      {labels[status] ?? status}
    </span>
  );
}
