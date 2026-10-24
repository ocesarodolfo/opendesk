"use client";

import { useEffect, useState } from "react";

type SectorItem = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  _count?: { numbers: number; conversations: number; memberships: number };
};

export default function SetoresClient() {
  const [items, setItems] = useState<SectorItem[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/sectors");
    if (res.ok) setItems(await res.json());
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/sectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: description || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Nao foi possivel cadastrar o setor.");
      return;
    }
    setName("");
    setDescription("");
    await load();
  }

  async function toggle(item: SectorItem) {
    const res = await fetch(`/api/sectors/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !item.active }),
    });
    if (res.ok) await load();
  }

  return (
    <div>
      <form onSubmit={create} className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-600">Nome do setor</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Financeiro, RH, Suporte..."
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
        </div>
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-medium text-slate-600">Descrição (opcional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
        </div>
        <button type="submit" className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">
          Cadastrar
        </button>
      </form>
      {error && <p className="mb-4 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Setor</th>
              <th className="px-4 py-2">Números</th>
              <th className="px-4 py-2">Atendimentos</th>
              <th className="px-4 py-2">Usuários</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Nenhum setor cadastrado.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{item.name}</p>
                  {item.description && <p className="text-xs text-slate-500">{item.description}</p>}
                </td>
                <td className="px-4 py-3">{item._count?.numbers ?? 0}</td>
                <td className="px-4 py-3">{item._count?.conversations ?? 0}</td>
                <td className="px-4 py-3">{item._count?.memberships ?? 0}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {item.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => void toggle(item)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    {item.active ? "Inativar" : "Ativar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
