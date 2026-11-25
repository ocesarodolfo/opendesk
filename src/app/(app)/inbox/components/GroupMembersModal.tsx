"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/modal";
import { IconAtSign, IconRefresh, IconSearch, IconUsers } from "@/components/icons";

export type GroupMember = {
  jid: string;
  phoneJid: string | null;
  lid: string | null;
  phone: string | null;
  name: string;
  role: "superadmin" | "admin" | "member";
  isSelf: boolean;
};

export type GroupInfo = {
  subject: string | null;
  description: string | null;
  size: number;
  addressingMode: "lid" | "pn" | null;
  connected: boolean;
  fallbackFromHistory: boolean;
  members: GroupMember[];
};

export function formatMemberPhone(d: string): string {
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d}`;
}

export function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function GroupMembersModal({
  open,
  onClose,
  groupName,
  groupInfo,
  loading,
  canMention,
  onRefresh,
  onMention,
}: {
  open: boolean;
  onClose: () => void;
  groupName: string;
  groupInfo: GroupInfo | null;
  loading: boolean;
  canMention: boolean;
  onRefresh: () => void;
  onMention: (member: GroupMember) => void;
}) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const members = groupInfo?.members ?? [];
  const filtered = useMemo(() => {
    const q = normalizeSearch(search.trim());
    if (!q) return members;
    return members.filter((m) => {
      const nameHit = normalizeSearch(m.name).includes(q);
      const phoneHit = m.phone ? m.phone.includes(q) || formatMemberPhone(m.phone).includes(q) : false;
      return nameHit || phoneHit;
    });
  }, [members, search]);

  const count = groupInfo?.size ?? members.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={groupInfo?.subject || groupName || "Membros do grupo"}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <IconUsers className="h-3.5 w-3.5 shrink-0" />
            {count} {count === 1 ? "participante" : "participantes"}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <IconRefresh className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>

        {groupInfo?.description ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Descrição do grupo
            </p>
            <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words chat-scroll">
              {groupInfo.description}
            </p>
          </div>
        ) : null}

        {groupInfo?.fallbackFromHistory ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Número desconectado — exibindo participantes identificados no histórico.
          </div>
        ) : null}

        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar membro por nome ou telefone..."
            className="w-full rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-sm focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100 chat-scroll">
          {loading && members.length === 0 ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex animate-pulse items-center gap-3 py-1">
                  <div className="h-8 w-8 rounded-full bg-slate-200" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 rounded bg-slate-200" />
                    <div className="h-2.5 w-24 rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">
              {members.length === 0
                ? "Nenhum participante encontrado para este grupo."
                : "Nenhum membro corresponde à busca."}
            </p>
          ) : (
            filtered.map((m) => {
              const avatarStyle = m.isSelf
                ? "bg-emerald-100 text-emerald-700"
                : m.role !== "member"
                  ? "bg-sky-100 text-sky-700"
                  : "bg-slate-200 text-slate-700";

              return (
                <div
                  key={m.jid}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-50"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarStyle}`}
                    >
                      {memberInitials(m.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-slate-900">
                          {m.name}
                        </span>
                        {m.isSelf ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Você
                          </span>
                        ) : null}
                        {m.role === "superadmin" ? (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                            Criador
                          </span>
                        ) : m.role === "admin" ? (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                            Admin
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {m.phone ? formatMemberPhone(m.phone) : "ID privado"}
                      </p>
                    </div>
                  </div>
                  {canMention && !m.isSelf ? (
                    <button
                      type="button"
                      onClick={() => onMention(m)}
                      title={`Mencionar ${m.name}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:border-sky-400 hover:bg-sky-50"
                    >
                      <IconAtSign className="h-3.5 w-3.5" />
                      Mencionar
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
