import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ReportRange = "hoje" | "7d" | "30d" | "custom";

export type ReportFilters = {
  range: ReportRange;
  from: string;
  to: string;
  sectorId: string;
  numberId: string;
  agentId: string;
  status: string;
};

const VALID_RANGES = new Set<string>(["hoje", "7d", "30d", "custom"]);
const VALID_STATUSES = new Set<string>(["PENDING", "OPEN", "CLOSED"]);

function parseDateParam(raw: string | undefined, endOfDay: boolean): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  if (endOfDay) dt.setHours(23, 59, 59, 999);
  else dt.setHours(0, 0, 0, 0);
  return dt;
}

export function parseReportFilters(params: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  sectorId?: string | null;
  numberId?: string | null;
  agentId?: string | null;
  status?: string | null;
}): ReportFilters {
  const from = (params.from ?? "").trim();
  const to = (params.to ?? "").trim();
  const hasCustomDates = Boolean(parseDateParam(from, false) || parseDateParam(to, true));

  let range: ReportRange = VALID_RANGES.has(params.range ?? "")
    ? (params.range as ReportRange)
    : "7d";
  if (hasCustomDates) {
    range = "custom";
  }
  if (range === "custom" && !hasCustomDates) {
    range = "7d";
  }

  return {
    range,
    from: range === "custom" ? from : "",
    to: range === "custom" ? to : "",
    sectorId: (params.sectorId ?? "").trim(),
    numberId: (params.numberId ?? "").trim(),
    agentId: (params.agentId ?? "").trim(),
    status: VALID_STATUSES.has(params.status ?? "") ? (params.status as string) : "",
  };
}

export function resolveReportPeriod(filters: ReportFilters): { fromDate: Date; toDate: Date | null } {
  if (filters.range === "custom") {
    const parsedFrom = parseDateParam(filters.from, false);
    const parsedTo = parseDateParam(filters.to, true);
    const fromDate = parsedFrom ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return { fromDate, toDate: parsedTo };
  }
  if (filters.range === "hoje") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { fromDate: d, toDate: null };
  }
  const days = filters.range === "7d" ? 7 : 30;
  return { fromDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000), toDate: null };
}

export function buildReportQueryString(filters: ReportFilters): string {
  const sp = new URLSearchParams();
  sp.set("range", filters.range);
  if (filters.range === "custom") {
    if (filters.from) sp.set("from", filters.from);
    if (filters.to) sp.set("to", filters.to);
  }
  if (filters.sectorId) sp.set("sectorId", filters.sectorId);
  if (filters.numberId) sp.set("numberId", filters.numberId);
  if (filters.agentId) sp.set("agentId", filters.agentId);
  if (filters.status) sp.set("status", filters.status);
  return sp.toString();
}

function dayKey(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export async function getReportData(filters: ReportFilters) {
  const { fromDate, toDate } = resolveReportPeriod(filters);
  const dateRangeFilter: Prisma.DateTimeFilter = {
    gte: fromDate,
    ...(toDate ? { lte: toDate } : {}),
  };

  const convScopeFilter: Prisma.ConversationWhereInput = {};
  if (filters.sectorId === "__none__") convScopeFilter.sectorId = null;
  else if (filters.sectorId) convScopeFilter.sectorId = filters.sectorId;

  if (filters.numberId) convScopeFilter.whatsappNumberId = filters.numberId;

  if (filters.agentId === "__unassigned__") convScopeFilter.assignedUserId = null;
  else if (filters.agentId) convScopeFilter.assignedUserId = filters.agentId;

  if (filters.status) convScopeFilter.status = filters.status;

  const hasConvScope = Object.keys(convScopeFilter).length > 0;

  const [conversationsInPeriod, messagesInPeriod] = await Promise.all([
    prisma.conversation.findMany({
      where: {
        createdAt: dateRangeFilter,
        ...convScopeFilter,
      },
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
    }),
    prisma.message.findMany({
      where: {
        createdAt: dateRangeFilter,
        ...(hasConvScope ? { conversation: convScopeFilter } : {}),
      },
      select: { direction: true, createdAt: true },
    }),
  ]);

  const created = conversationsInPeriod.length;
  const closedInPeriod = conversationsInPeriod.filter(
    (c) => c.closedAt && c.closedAt >= fromDate && (!toDate || c.closedAt <= toDate)
  ).length;
  const incoming = messagesInPeriod.filter((m) => m.direction === "INCOMING").length;
  const outgoing = messagesInPeriod.filter((m) => m.direction === "OUTGOING").length;

  const replyDeltasMin: number[] = [];
  for (const c of conversationsInPeriod) {
    const sorted = [...c.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const firstIn = sorted.find((m) => m.direction === "INCOMING");
    if (!firstIn) continue;
    const firstOut = sorted.find(
      (m) => m.direction === "OUTGOING" && m.createdAt > firstIn.createdAt
    );
    if (!firstOut) continue;
    replyDeltasMin.push((firstOut.createdAt.getTime() - firstIn.createdAt.getTime()) / 60000);
  }
  const avgFirstReplyMin =
    replyDeltasMin.length > 0
      ? Math.round(replyDeltasMin.reduce((a, b) => a + b, 0) / replyDeltasMin.length)
      : null;

  const bySector = new Map<string, number>();
  for (const c of conversationsInPeriod) {
    const key = c.sector?.name ?? "Sem setor";
    bySector.set(key, (bySector.get(key) ?? 0) + 1);
  }

  const byAgent = new Map<string, { closed: number; assigned: number }>();
  for (const c of conversationsInPeriod) {
    if (!c.assignedUser) continue;
    const row = byAgent.get(c.assignedUser.name) ?? { closed: 0, assigned: 0 };
    if (c.closedAt && c.closedAt >= fromDate && (!toDate || c.closedAt <= toDate)) {
      row.closed += 1;
    }
    row.assigned += 1;
    byAgent.set(c.assignedUser.name, row);
  }

  const daily = new Map<string, { in: number; out: number }>();
  for (const m of messagesInPeriod) {
    const k = dayKey(m.createdAt);
    const row = daily.get(k) ?? { in: 0, out: 0 };
    if (m.direction === "INCOMING") row.in += 1;
    else row.out += 1;
    daily.set(k, row);
  }
  const maxDaily = Math.max(1, ...[...daily.values()].map((v) => v.in + v.out));

  return {
    created,
    closedInPeriod,
    incoming,
    outgoing,
    avgFirstReplyMin,
    sectors: [...bySector.entries()].sort((a, b) => b[1] - a[1]),
    agents: [...byAgent.entries()].sort((a, b) => b[1].closed - a[1].closed),
    dailyRows: [...daily.entries()].sort(
      (a, b) =>
        a[0].split("/")[1].localeCompare(b[0].split("/")[1]) || a[0].localeCompare(b[0])
    ),
    maxDaily,
  };
}
