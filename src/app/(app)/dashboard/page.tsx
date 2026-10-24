import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { conversationVisibilityFilter, getSectorScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const scope = await getSectorScope(session);
  // escopo por setor (F3): contagens e ultimas conversas respeitam o que
  // o usuario pode ver (ADMIN: tudo; agente: seus setores + numeros sem setor)
  const visibility = conversationVisibilityFilter(scope);

  const [openCount, pendingCount, closedToday, connectedNumbers, totalNumbers, contacts, recent] =
    await Promise.all([
      prisma.conversation.count({ where: { status: "OPEN", ...visibility } }),
      prisma.conversation.count({ where: { status: "PENDING", ...visibility } }),
      prisma.conversation.count({
        where: { status: "CLOSED", lastMessageAt: { gte: startOfToday() }, ...visibility },
      }),
      prisma.whatsAppNumber.count({ where: { status: "CONNECTED" } }),
      prisma.whatsAppNumber.count(),
      prisma.contact.count(),
      prisma.conversation.findMany({
        where: visibility,
        orderBy: { lastMessageAt: "desc" },
        take: 6,
        include: { contact: true, sector: true, whatsappNumber: true },
      }),
    ]);

  const cards = [
    { label: "Em atendimento (OPEN)", value: openCount, tone: "text-emerald-600" },
    { label: "Aguardando (PENDING)", value: pendingCount, tone: "text-amber-600" },
    { label: "Encerradas hoje", value: closedToday, tone: "text-slate-700" },
    { label: "Números conectados", value: `${connectedNumbers}/${totalNumbers}`, tone: "text-sky-600" },
    { label: "Contatos cadastrados", value: contacts, tone: "text-slate-700" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className={`mt-2 text-2xl font-bold ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold">Últimas conversas</h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Contato</th>
              <th className="px-4 py-2">Número</th>
              <th className="px-4 py-2">Setor</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Última mensagem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {recent.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma conversa ainda. Conecte um número e aguarde as primeiras mensagens.
                </td>
              </tr>
            )}
            {recent.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2 font-medium">{c.contact.name ?? c.contact.phone}</td>
                <td className="px-4 py-2 text-slate-600">{c.whatsappNumber.label}</td>
                <td className="px-4 py-2 text-slate-600">{c.sector?.name ?? "—"}</td>
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
  );
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
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
