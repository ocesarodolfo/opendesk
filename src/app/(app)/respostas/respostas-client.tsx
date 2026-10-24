"use client";

import { useEffect, useState } from "react";

type SectorOption = { id: string; name: string; active: boolean };

type Reply = {
  id: string;
  shortcut: string;
  content: string;
  active: boolean;
  sectorId: string | null;
  sectorName: string | null;
};

export default function RespostasClient() {
  const [items, setItems] = useState<Reply[]>([]);
  const [sectors, setSectors] = useState<SectorOption[]>([]);
  const [shortcut, setShortcut] = useState("");
  const [content, setContent] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ shortcut: string; content: string; sectorId: string }>({
    shortcut: "",
    content: "",
    sectorId: "",
  });

  async function load() {
    const r = await fetch("/api/quick-replies?all=1");
    if (r.ok) setItems(await r.json());
    const s = await fetch("/api/sectors");
    if (s.ok) setSectors((await s.json()).filter((x: SectorOption) => x.active));
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/quick-replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shortcut, content, sectorId: sectorId || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Nao foi possivel criar.");
      return;
    }
    setShortcut("");
    setContent("");
    setSectorId("");
    await load();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/quick-replies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "Acao nao permitida.");
      return;
    }
    setEditing(null);
    await load();
  }

  async function del(item: Reply) {
    if (!confirm(`Excluir a resposta "${item.shortcut}"?`)) return;
    const res = await fetch(`/api/quick-replies/${item.id}`, { method: "DELETE" });
    if (res.ok) await load();
    else alert("Nao foi possivel excluir.");
  }

  return (
    <div>
      <form
        onSubmit={create}
        className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="min-w-[160px]">
          <label className="block text-xs font-medium text-slate-600">Atalho</label>
          <input
            required
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value)}
            placeholder="ex.: senha-ti"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
        </div>
        <div className="min-w-[420px] flex-1">
          <label className="block text-xs font-medium text-slate-600">Mensagem</label>
          <textarea
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
        </div>
        <div className="min-w-[180px]">
          <label className="block text-xs font-medium text-slate-600">Setor</label>
          <select
            value={sectorId}
            onChange={(e) => setSectorId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          >
            <option value="">Todos os setores</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
        >
          Adicionar
        </button>
        {error && <p className="w-full text-sm text-rose-600">{error}</p>}
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Atalho</th>
              <th className="px-4 py-2">Mensagem</th>
              <th className="px-4 py-2">Setor</th>
              <th className="px-4 py-2">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma resposta rápida cadastrada.
                </td>
              </tr>
            )}
            {items.map((item) => {
              if (editing === item.id) {
                return (
                  <tr key={item.id}>
                    <td className="px-4 py-2">
                      <input
                        value={draft.shortcut}
                        onChange={(e) => setDraft((d) => ({ ...d, shortcut: e.target.value }))}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <textarea
                        value={draft.content}
                        onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                        rows={2}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={draft.sectorId}
                        onChange={(e) => setDraft((d) => ({ ...d, sectorId: e.target.value }))}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      >
                        <option value="">Todos</option>
                        {sectors.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            void patch(item.id, {
                              shortcut: draft.shortcut,
                              content: draft.content,
                              ...(draft.sectorId === "" ? { sectorId: null } : { sectorId: draft.sectorId }),
                            })
                          }
                          className="rounded bg-sky-600 px-2 py-1 text-xs font-semibold text-white"
                        >
                          Salvar
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-mono text-xs font-semibold text-slate-700">
                    {item.shortcut}
                  </td>
                  <td className="max-w-[420px] truncate px-4 py-2 text-slate-600">{item.content}</td>
                  <td className="px-4 py-2 text-slate-600">{item.sectorName ?? "Todos os setores"}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditing(item.id);
                          setDraft({
                            shortcut: item.shortcut,
                            content: item.content,
                            sectorId: item.sectorId ?? "",
                          });
                        }}
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() =>
                          void patch(item.id, { active: !item.active })
                        }
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        {item.active ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        onClick={() => void del(item)}
                        className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
