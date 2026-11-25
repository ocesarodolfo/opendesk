"use client";

import {
  formatMemberPhone,
  memberInitials,
  type GroupMember,
} from "./GroupMembersModal";

export function MentionPopover({
  members,
  activeIndex,
  onSelect,
  onHover,
}: {
  members: GroupMember[];
  activeIndex: number;
  onSelect: (member: GroupMember) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div className="absolute bottom-full left-3 right-3 z-20 mb-2 max-h-[40vh] max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg chat-scroll">
      {members.length === 0 ? (
        <p className="p-3 text-xs text-slate-500">Nenhum membro encontrado.</p>
      ) : (
        members.map((m, idx) => {
          const active = idx === Math.min(activeIndex, members.length - 1);
          return (
            <button
              key={m.jid}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(m);
              }}
              onMouseEnter={() => onHover(idx)}
              className={`flex w-full items-center gap-2.5 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 ${
                active ? "bg-sky-50" : "hover:bg-slate-50"
              }`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-700">
                {memberInitials(m.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-slate-900">
                    {m.name}
                  </span>
                  {m.role !== "member" ? (
                    <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                      {m.role === "superadmin" ? "Criador" : "Admin"}
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-[11px] text-slate-500">
                  {m.phone ? formatMemberPhone(m.phone) : "ID privado"}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
