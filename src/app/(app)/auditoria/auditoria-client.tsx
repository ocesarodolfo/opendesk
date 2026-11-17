"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "@/components/modal";
import { IconDownload } from "@/components/icons";

type AuditItem = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  detail: string | null;
  actorId: string | null;
  actorName: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: string | null;
  createdAt: string;
};

type ActorOption = {
  id: string;
  name: string;
};

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "Login",
  LOGIN_FALHA: "Falha no login",
  LOGOUT: "Logout",
  SENHA_TROCA: "Troca de senha",
  CONVERSA_STATUS: "Status da conversa",
  CONVERSA_ATRIBUICAO: "Atribuição de conversa",
  CONVERSA_SETOR: "Setor da conversa",
  CONVERSA_LOTE: "Atribuição em lote",
  MENSAGEM_ENVIADA: "Mensagem enviada",
  MIDIA_ENVIADA: "Mídia enviada",
  MENSAGEM_APAGADA: "Mensagem apagada",
  REACAO: "Reação",
  CONTATO_RENOME: "Contato renomeado",
  CONTATO_ETIQUETAS: "Etiquetas do contato",
  USUARIO_CRIADO: "Usuário criado",
  USUARIO_ATUALIZADO: "Usuário atualizado",
  USUARIO_EXCLUIDO: "Usuário excluído",
  SETOR_CRIADO: "Setor criado",
  SETOR_ATUALIZADO: "Setor atualizado",
  SETOR_EXCLUIDO: "Setor excluído",
  ETIQUETA_CRIADA: "Etiqueta criada",
  ETIQUETA_ATUALIZADA: "Etiqueta atualizada",
  ETIQUETA_EXCLUIDA: "Etiqueta excluída",
  RESPOSTA_CRIADA: "Resposta rápida criada",
  RESPOSTA_ATUALIZADA: "Resposta rápida atualizada",
  RESPOSTA_EXCLUIDA: "Resposta rápida excluída",
  NUMERO_CRIADO: "Número criado",
  NUMERO_ATUALIZADO: "Número atualizado",
  NUMERO_CONEXAO: "Conexão de número",
  NUMERO_EXCLUIDO: "Número excluído",
};

const ENTITY_LABELS: Record<string, string> = {
  User: "Usuário",
  Conversation: "Conversa",
  Contact: "Contato",
  WhatsAppNumber: "Número WhatsApp",
  Sector: "Setor",
  Tag: "Etiqueta",
  QuickReply: "Resposta rápida",
};

function actionBadgeClass(action: string): string {
  if (action.includes("FALHA") || action.includes("EXCLUID") || action.includes("APAGADA")) {
    return "bg-rose-100 text-rose-700";
  }
  if (action.includes("CRIAD") || action === "LOGIN") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (action.includes("ATUALIZAD") || action.includes("RENOME") || action.includes("SENHA")) {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-sky-50 text-sky-700";
}

function formatMetadata(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function AuditoriaClient() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [actors, setActors] = useState<ActorOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<AuditItem | null>(null);

  const queryParams = useMemo(() => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (action) sp.set("action", action);
    if (entity) sp.set("entity", entity);
    if (actorId) sp.set("actorId", actorId);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    return sp;
  }, [q, action, entity, actorId, from, to]);

  const load = useCallback(
    async (targetPage = page) => {
      setLoading(true);
      try {
        const sp = new URLSearchParams(queryParams);
        sp.set("page", String(targetPage));
        sp.set("limit", "50");
        const res = await fetch(`/api/audit?${sp.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          items: AuditItem[];
          total: number;
          page: number;
          totalPages: number;
          actors: ActorOption[];
        };
        setItems(data.items);
        setTotal(data.total);
        setPage(data.page);
        setTotalPages(data.totalPages);
        setActors(data.actors);
      } finally {
        setLoading(false);
      }
    },
    [page, queryParams]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void load(1);
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParams]);

  function clearFilters() {
    setQ("");
    setAction("");
    setEntity("");
    setActorId("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  const csvUrl = useMemo(() => {
    const sp = new URLSearchParams(queryParams);
    sp.set("format", "csv");
    return `/api/audit?${sp.toString()}`;
  }, [queryParams]);

  const hasFilters = Boolean(q || action || entity || actorId || from || to);

  return (
    <div className="space-y-4">
      {/* filtros */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-slate-600">Busca</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Detalhe, usuário, IP ou ID..."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Ação</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
            >
              <option value="">Todas</option>
              {Object.entries(ACTION_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Entidade</label>
            <select
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
            >
              <option value="">Todas</option>
              {Object.entries(ENTITY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Usuário</label>
            <select
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
            >
              <option value="">Todos</option>
              <option value="__system__">Sistema</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-600">De</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Até</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            {total} {total === 1 ? "registro encontrado" : "registros encontrados"}
          </p>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Limpar filtros
              </button>
            )}
            <button
              type="button"
              onClick={() => void load(page)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Atualizar
            </button>
            <a
              href={csvUrl}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
            >
              <IconDownload className="h-3.5 w-3.5" />
              Exportar CSV
            </a>
          </div>
        </div>
      </div>

      {/* tabela */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Data/Hora</th>
              <th className="px-4 py-2.5">Quem</th>
              <th className="px-4 py-2.5">Ação</th>
              <th className="px-4 py-2.5">Entidade</th>
              <th className="px-4 py-2.5">Detalhe</th>
              <th className="px-4 py-2.5">IP</th>
              <th className="px-4 py-2.5 text-right">Registro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                  Carregando registros...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                  Nenhum registro encontrado para os filtros selecionados.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-600 tabular-nums">
                    {new Date(item.createdAt).toLocaleString("pt-BR")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-800">
                    {item.actorName ?? <span className="text-slate-400">Sistema</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${actionBadgeClass(
                        item.action
                      )}`}
                    >
                      {ACTION_LABELS[item.action] ?? item.action}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-600">
                    <span>{ENTITY_LABELS[item.entity] ?? item.entity}</span>
                    {item.entityId ? (
                      <span className="ml-1 font-mono text-[11px] text-slate-400">
                        #{item.entityId.slice(0, 8)}
                      </span>
                    ) : null}
                  </td>
                  <td className="max-w-md truncate px-4 py-2.5 text-xs text-slate-700" title={item.detail ?? ""}>
                    {item.detail || "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-500">
                    {item.ip ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(item)}
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Detalhes
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* paginacao */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => void load(page - 1)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => void load(page + 1)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {/* modal de detalhes */}
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Detalhes do registro de auditoria"
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-xs">
              <div>
                <p className="text-slate-400">Data/Hora</p>
                <p className="font-medium text-slate-800">
                  {new Date(selected.createdAt).toLocaleString("pt-BR")}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Quem executou</p>
                <p className="font-medium text-slate-800">
                  {selected.actorName ?? "Sistema"}
                  {selected.actorId ? (
                    <span className="ml-1 font-mono text-[11px] text-slate-400">
                      ({selected.actorId.slice(0, 8)})
                    </span>
                  ) : null}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Ação</p>
                <p className="font-medium text-slate-800">
                  {ACTION_LABELS[selected.action] ?? selected.action}{" "}
                  <span className="font-mono text-[11px] text-slate-400">({selected.action})</span>
                </p>
              </div>
              <div>
                <p className="text-slate-400">Entidade</p>
                <p className="font-medium text-slate-800">
                  {ENTITY_LABELS[selected.entity] ?? selected.entity}
                  {selected.entityId ? (
                    <span className="ml-1 font-mono text-[11px] text-slate-500">
                      {selected.entityId}
                    </span>
                  ) : null}
                </p>
              </div>
              <div>
                <p className="text-slate-400">IP</p>
                <p className="font-mono text-slate-800">{selected.ip ?? "—"}</p>
              </div>
              <div>
                <p className="text-slate-400">ID do log</p>
                <p className="truncate font-mono text-[11px] text-slate-600">{selected.id}</p>
              </div>
            </div>

            {selected.detail && (
              <div>
                <p className="text-xs font-medium text-slate-500">Resumo</p>
                <p className="mt-1 rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-700">
                  {selected.detail}
                </p>
              </div>
            )}

            {selected.userAgent && (
              <div>
                <p className="text-xs font-medium text-slate-500">User-Agent</p>
                <p className="mt-1 break-all rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-600">
                  {selected.userAgent}
                </p>
              </div>
            )}

            {selected.metadata && (
              <div>
                <p className="text-xs font-medium text-slate-500">Dados (antes / depois)</p>
                <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-slate-200 bg-slate-900 p-3 font-mono text-xs text-slate-100">
                  {formatMetadata(selected.metadata)}
                </pre>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

