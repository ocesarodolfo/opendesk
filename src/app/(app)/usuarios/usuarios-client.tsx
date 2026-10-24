"use client";

import { useEffect, useState } from "react";

type UserItem = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "AGENT";
  active: boolean;
  sectors: { id: string; name: string }[];
};

type SectorItem = {
  id: string;
  name: string;
  active: boolean;
};

export default function UsuariosClient() {
  const [items, setItems] = useState<UserItem[]>([]);
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [editing, setEditing] = useState<string | null>(null); // id do usuario em edicao
  const [draft, setDraft] = useState<string[]>([]); // setores marcados
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [r1, r2] = await Promise.all([fetch("/api/users"), fetch("/api/sectors")]);
    if (r1.ok) setItems(await r1.json());
    if (r2.ok) setSectors((await r2.json()).filter((s: SectorItem) => s.active));
  }

  function openEdit(item: UserItem) {
    setEditing(editing === item.id ? null : item.id);
    setDraft(item.sectors.map((s) => s.id));
    // admin nao precisa de vinculos: ve tudo
    setError(null);
  }

  async function saveSectors(item: UserItem) {
    const res = await fetch(`/api/users/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectorIds: item.role === "ADMIN" ? [] : draft }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Nao foi possivel salvar os setores.");
      return;
    }
    setEditing(null);
    await load();
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Nao foi possivel cadastrar o usuario.");
      return;
    }
    setName("");
    setEmail("");
    setPassword("");
    setRole("AGENT");
    await load();
  }

  async function toggle(item: UserItem) {
    const res = await fetch(`/api/users/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !item.active }),
    });
    if (res.ok) await load();
    else {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "Acao nao permitida.");
    }
  }

  return (
    <div>
      <form onSubmit={create} className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-[180px]">
          <label className="block text-xs font-medium text-slate-600">Nome</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
        </div>
        <div className="min-w-[220px]">
          <label className="block text-xs font-medium text-slate-600">E-mail</label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
        </div>
        <div className="min-w-[150px]">
          <label className="block text-xs font-medium text-slate-600">Senha</label>
          <input
            required
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">Perfil</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "ADMIN" | "AGENT")}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          >
            <option value="AGENT">Atendente</option>
            <option value="ADMIN">Administrador</option>
          </select>
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
              <th className="px-4 py-2">Usuário</th>
              <th className="px-4 py-2">E-mail</th>
              <th className="px-4 py-2">Perfil</th>
              <th className="px-4 py-2">Setores</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3 font-medium">{item.name}</td>
                <td className="px-4 py-3 text-slate-600">{item.email}</td>
                <td className="px-4 py-3">{item.role === "ADMIN" ? "Administrador" : "Atendente"}</td>
                <td className="px-4 py-3">
                  {item.role === "ADMIN" ? (
                    <span className="text-xs text-slate-400">Todos (papel ADMIN)</span>
                  ) : item.sectors.length === 0 ? (
                    <span className="text-xs text-slate-400">— (só números sem setor)</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {item.sectors.map((s) => (
                        <span key={s.id} className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(item)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Setores
                    </button>
                    <button
                      onClick={() => void toggle(item)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      {item.active ? "Inativar" : "Ativar"}
                    </button>
                  </div>
                  {editing === item.id && item.role !== "ADMIN" && (
                    <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Setores do usuário</p>
                      {sectors.length === 0 ? (
                        <p className="mt-2 text-xs text-slate-500">Nenhum setor ativo cadastrado.</p>
                      ) : (
                        <div className="mt-2 space-y-1">
                          {sectors.map((s) => (
                            <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={draft.includes(s.id)}
                                onChange={(e) =>
                                  setDraft((prev) =>
                                    e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                                  )
                                }
                              />
                              {s.name}
                            </label>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => void saveSectors(item)}
                          className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
                        >
                          Salvar
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
