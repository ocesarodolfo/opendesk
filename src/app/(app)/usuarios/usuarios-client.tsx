"use client";

import { useEffect, useState } from "react";
import { showToast } from "@/components/toast";
import { IconStar } from "@/components/icons";
import Modal from "@/components/modal";

type UserItem = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "AGENT";
  active: boolean;
  sectors: { id: string; name: string; role: string }[];
};

type SectorItem = {
  id: string;
  name: string;
  active: boolean;
};

export default function UsuariosClient() {
  const [items, setItems] = useState<UserItem[]>([]);
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // id do usuario em edicao de setores
  const [editingUser, setEditingUser] = useState<string | null>(null); // id do usuario em edicao de dados
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [editPassword, setEditPassword] = useState("");
  const [draftRoles, setDraftRoles] = useState<Record<string, string>>({}); // sectorId -> AGENT|SUPERVISOR
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
    setEditingUser(null);
    setEditing(item.id);
    setDraftRoles(
      Object.fromEntries(item.sectors.map((s) => [s.id, s.role === "SUPERVISOR" ? "SUPERVISOR" : "AGENT"]))
    );
    setError(null);
  }

  function openEditUser(item: UserItem) {
    setEditing(null);
    setEditingUser(item.id);
    setEditName(item.name);
    setEditEmail(item.email);
    setEditRole(item.role);
    setEditPassword("");
    setError(null);
  }

  async function saveUser(item: UserItem) {
    setError(null);
    if (editPassword && editPassword.length < 8) {
      setError("A nova senha precisa ter ao menos 8 caracteres.");
      return;
    }
    const payload: Record<string, unknown> = {
      name: editName,
      email: editEmail,
      role: editRole,
    };
    if (editPassword) payload.password = editPassword;

    const res = await fetch(`/api/users/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Nao foi possivel atualizar o usuario.");
      return;
    }
    setEditingUser(null);
    setEditPassword("");
    showToast("Usuario atualizado.", "sucesso");
    await load();
  }

  async function saveSectors(item: UserItem) {
    const membershipRoles = Object.entries(draftRoles).map(([sectorId, role]) => ({
      sectorId,
      role: role === "SUPERVISOR" ? "SUPERVISOR" : "AGENT",
    }));
    const res = await fetch(`/api/users/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item.role === "ADMIN" ? { membershipRoles: [] } : { membershipRoles }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Nao foi possivel salvar os setores.");
      return;
    }
    setEditing(null);
    showToast("Setores atualizados.", "sucesso");
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
    setCreateOpen(false);
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
      showToast(data?.error ?? "Acao nao permitida.", "erro");
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setCreateOpen(true);
          }}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
        >
          Novo usuário
        </button>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo usuário">
        <form onSubmit={create} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Nome</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">E-mail</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
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
          {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
            >
              Cadastrar
            </button>
          </div>
        </form>
      </Modal>

      {(() => {
        const editingUserItem = items.find((u) => u.id === editingUser) ?? null;
        const editingSectorsItem = items.find((u) => u.id === editing) ?? null;
        return (
          <>
            <Modal
              open={Boolean(editingUserItem)}
              onClose={() => {
                setEditingUser(null);
                setError(null);
              }}
              title="Editar usuário"
            >
              {editingUserItem && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveUser(editingUserItem);
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-xs font-medium text-slate-600">Nome</label>
                    <input
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600">E-mail</label>
                    <input
                      required
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600">Perfil</label>
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as "ADMIN" | "AGENT")}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                    >
                      <option value="AGENT">Atendente</option>
                      <option value="ADMIN">Administrador</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      Nova senha (opcional, mín. 8 caracteres)
                    </label>
                    <input
                      type="password"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      placeholder="Deixe em branco para manter a atual"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  {error && (
                    <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingUser(null);
                        setError(null);
                      }}
                      className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                    >
                      Salvar
                    </button>
                  </div>
                </form>
              )}
            </Modal>

            <Modal
              open={Boolean(editingSectorsItem)}
              onClose={() => {
                setEditing(null);
                setError(null);
              }}
              title={
                editingSectorsItem
                  ? `Setores de ${editingSectorsItem.name}`
                  : "Setores do usuário"
              }
            >
              {editingSectorsItem && (
                <div className="space-y-4">
                  {editingSectorsItem.role === "ADMIN" ? (
                    <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                      Usuários com perfil <strong>Administrador</strong> têm acesso automático a todos os setores.
                    </p>
                  ) : sectors.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum setor ativo cadastrado.</p>
                  ) : (
                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {sectors.map((s) => (
                        <label
                          key={s.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={s.id in draftRoles}
                              onChange={(e) =>
                                setDraftRoles((prev) => {
                                  const next = { ...prev };
                                  if (e.target.checked) next[s.id] = next[s.id] ?? "AGENT";
                                  else delete next[s.id];
                                  return next;
                                })
                              }
                            />
                            <span>{s.name}</span>
                          </span>
                          {s.id in draftRoles ? (
                            <select
                              value={draftRoles[s.id]}
                              onChange={(e) =>
                                setDraftRoles((prev) => ({ ...prev, [s.id]: e.target.value }))
                              }
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 focus:border-sky-500 focus:outline-none"
                            >
                              <option value="AGENT">Atendente</option>
                              <option value="SUPERVISOR">Supervisor</option>
                            </select>
                          ) : null}
                        </label>
                      ))}
                    </div>
                  )}
                  {error && (
                    <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        setError(null);
                      }}
                      className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      {editingSectorsItem.role === "ADMIN" ? "Fechar" : "Cancelar"}
                    </button>
                    {editingSectorsItem.role !== "ADMIN" && (
                      <button
                        type="button"
                        onClick={() => void saveSectors(editingSectorsItem)}
                        className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                      >
                        Salvar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </Modal>
          </>
        );
      })()}

      {!createOpen && !editingUser && !editing && error && (
        <p className="mb-4 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
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
                        <span
                          key={s.id}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            s.role === "SUPERVISOR"
                              ? "bg-violet-100 text-violet-700"
                              : "bg-sky-50 text-sky-700"
                          }`}
                        >
                          {s.role === "SUPERVISOR" ? (
                            <>
                              <IconStar className="mr-1 inline h-3.5 w-3.5 text-amber-400" /> {s.name}
                            </>
                          ) : (
                            s.name
                          )}
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
                      onClick={() => openEditUser(item)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Editar
                    </button>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

