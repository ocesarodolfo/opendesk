"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = "PENDING" | "OPEN" | "CLOSED";
type StatusFilter = Status | "ALL";

type ConversationItem = {
  id: string;
  status: Status;
  lastMessage: string;
  lastMessageAt: string;
  contactName: string;
  contactPhone: string;
  contactId: string;
  contactIsGroup: boolean;
  numberLabel: string;
  sectorId: string | null;
  sectorName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  contactTags?: TagItem[];
};

type TagItem = { id: string; name: string; color: string };

type MessageItem = {
  id: string;
  direction: "INCOMING" | "OUTGOING";
  content: string;
  createdAt: string;
  status: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  fileName?: string | null;
  senderName?: string | null;
  quotedSnippet?: string | null;
  quotedSender?: string | null;
  reaction?: string | null;
  reactionMine?: boolean | null;
};

type UserOption = { id: string; name: string };
type SectorOption = { id: string; name: string; active: boolean };
type Me = { id: string; name: string; role: "ADMIN" | "AGENT"; supervisorSectorIds: string[] };
type Reply = { id: string; shortcut: string; content: string; sectorName: string | null };

type ConversationDetail = {
  conversation: ConversationItem;
  messages: MessageItem[];
};

const STATUS_META: Record<Status, { label: string; chip: string }> = {
  PENDING: { label: "Pendente", chip: "bg-amber-100 text-amber-700" },
  OPEN: { label: "Aberto", chip: "bg-emerald-100 text-emerald-700" },
  CLOSED: { label: "Encerrado", chip: "bg-slate-100 text-slate-600" },
};

// emojis rapidos para reagir as mensagens na bolha
const QUICK_EMOJIS = ["👍", "❤️", "😂", "🙏"];

// Exibe o numero de telefone BR como +55 (DDD) 00000-0000 (quando reconhecido)
function formatPhone(d: string): string {
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d}`;
}

// classes estaticas por cor de etiqueta (nao posso montar dinamicamente p/ Tailwind)
const TAG_CHIP: Record<string, string> = {
  slate: "bg-slate-100 text-slate-600",
  emerald: "bg-emerald-100 text-emerald-700",
  sky: "bg-sky-100 text-sky-700",
  amber: "bg-amber-100 text-amber-700",
  rose: "bg-rose-100 text-rose-700",
  violet: "bg-violet-100 text-violet-700",
};

const TAG_DOT: Record<string, string> = {
  slate: "bg-slate-400",
  emerald: "bg-emerald-400",
  sky: "bg-sky-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  violet: "bg-violet-400",
};

export default function InboxClient() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING");
  const [query, setQuery] = useState("");
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [usersList, setUsersList] = useState<UserOption[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [sectorsList, setSectorsList] = useState<SectorOption[]>([]);
  const [movingSector, setMovingSector] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [muted, setMuted] = useState(false);
  const [soundName, setSoundName] = useState("classico");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkApplying, setBulkApplying] = useState(false);
  const [quickReplies, setQuickReplies] = useState<Reply[]>([]);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tagOptions, setTagOptions] = useState<TagItem[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagEditing, setTagEditing] = useState(false);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<string | null>(null);

  // mantem o id da conversa aberta acessivel no listener SSE
  // (evita reconectar o EventSource a cada selecao)
  useEffect(() => {
    selectedIdRef.current = selected?.conversation.id ?? null;
  }, [selected]);

  useEffect(() => {
    const stored = localStorage.getItem("atende_mute");
    if (stored === "1") setMuted(true);
    setSoundName(localStorage.getItem("atende_sound") ?? "classico");
    void fetch("/api/users")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: UserOption[]) => setUsersList(list));
    void fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((info: Me | null) => setMe(info));
    void fetch("/api/sectors")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: SectorOption[]) => setSectorsList(list.filter((s) => s.active)));
    void fetch("/api/quick-replies")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Reply[]) => setQuickReplies(list));
    void fetch("/api/tags")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: TagItem[]) => setTagOptions(list));
  }, []);

  const loadList = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (query.trim()) params.set("q", query.trim());
    const qs = params.toString();
    const res = await fetch(`/api/conversations${qs ? `?${qs}` : ""}`);
    if (res.ok) setConversations(await res.json());
  }, [statusFilter, query]);

  const loadDetail = useCallback(async (id: string) => {
    setRepliesOpen(false);
    setEditingName(false);
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) setSelected(await res.json());
    else setSelected(null);
  }, []);

  // Carrega lista ao filtrar/buscar
  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Tempo real via SSE
  useEffect(() => {
    const source = new EventSource("/api/realtime");
    source.onmessage = (event) => {
      try {
        const evt = JSON.parse(event.data) as {
          type: string;
          conversationId?: string;
          message?: { direction?: string };
        };
        if (
          evt.type === "message:new" &&
          typeof evt.conversationId === "string"
        ) {
          if (evt.conversationId === selectedIdRef.current) {
            void loadDetail(evt.conversationId);
          }
          // aviso sonoro: nova mensagem recebida em conversa ainda nao assumida
          if (
            !muted &&
            evt.message?.direction === "INCOMING" &&
            evt.conversationId !== selectedIdRef.current
          ) {
            playSound(soundName);
          }
          void loadList();
        }
        if (evt.type === "message:update" && typeof evt.conversationId === "string") {
          // reacao: atualiza a bolha em tela sem recarregar tudo
          const upd = evt.message as { id: string; reaction: string | null; reactionMine: boolean | null };
          setSelected((prev) =>
            prev && prev.conversation.id === evt.conversationId
              ? {
                  ...prev,
                  messages: prev.messages.map((m) =>
                    m.id === upd.id ? { ...m, reaction: upd.reaction, reactionMine: upd.reactionMine } : m
                  ),
                }
              : prev
          );
        }
        if (evt.type === "conversation:update") {
          void loadList();
        }
      } catch {
        /* ignora eventos malformados */
      }
    };
    return () => source.close();
  }, [loadList, loadDetail, muted, soundName]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selected?.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !selected) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${selected.conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        setDraft("");
        await loadDetail(selected.conversation.id);
        await loadList();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Nao foi possivel enviar a mensagem.");
      }
    } finally {
      setSending(false);
    }
  }

  async function act(action: "take" | "close") {
    if (!selected) return;
    const status = action === "take" ? "OPEN" : "CLOSED";
    const res = await fetch(`/api/conversations/${selected.conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      await loadDetail(selected.conversation.id);
      await loadList();
    }
  }

  // transferencia de conversa entre atendentes
  async function assignTo(userId: string | null) {
    if (!selected) return;
    const res = await fetch(`/api/conversations/${selected.conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedUserId: userId }),
    });
    if (res.ok) {
      await loadDetail(selected.conversation.id);
      await loadList();
    } else {
      alert("Nao foi possivel transferir a conversa.");
    }
  }

  // Colar (Ctrl+V) um arquivo da area de transferência envia como mídia —
  // como o WhatsApp Web faz. Texto colado segue o caminho normal.
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    if (!canSend || uploading) return;
    const file = [...Array.from(e.clipboardData.files ?? [])].find(
      (f) =>
        f.size <= 25 * 1024 * 1024 &&
        (f.type.startsWith("image/") || f.type.startsWith("video/") || f.type.startsWith("audio/"))
    );
    if (file) {
      e.preventDefault();
      void uploadMedia(file);
    }
  }

  // atribuicao em lote (poder de ADMIN ou SUPERVISOR de setor)
  const canBulk =
    me?.role === "ADMIN" || (me?.supervisorSectorIds?.length ?? 0) > 0;

  function toggleBulk(id: string) {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulk(assignedUserId: string | null) {
    if (bulkSelected.size === 0) return;
    if (assignedUserId && usersList.some((u) => u.id === assignedUserId) === false) {
      return;
    }
    setBulkApplying(true);
    try {
      const res = await fetch("/api/conversations/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationIds: [...bulkSelected], assignedUserId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Nao foi possivel atribuir em lote.");
        return;
      }
      setBulkSelected(new Set());
      await loadList();
    } finally {
      setBulkApplying(false);
    }
  }

  // renomear contato (null = volta a usar o pushName do WhatsApp)
  async function saveContactName(name: string | null) {
    if (!selected) return;
    const res = await fetch(`/api/contacts/${selected.conversation.contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      alert("Nao foi possivel salvar o nome do contato.");
      return;
    }
    setEditingName(false);
    await loadDetail(selected.conversation.id);
    await loadList();
  }

  // ---- etiquetas do contato ----
  async function applyContactTags(tags: TagItem[]) {
    if (!selected) return;
    const res = await fetch(`/api/contacts/${selected.conversation.contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagIds: tags.map((t) => t.id) }),
    });
    if (!res.ok) {
      alert("Nao foi possivel salvar as etiquetas do contato.");
      return;
    }
    await loadDetail(selected.conversation.id);
  }

  async function addContactTag(rawName: string) {
    const name = rawName.trim();
    if (!selected || !name) return;
    setTagInput("");
    let tag = tagOptions.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!tag) {
      if (me?.role !== "ADMIN") {
        alert("Etiqueta inexistente. Peça a um administrador para criá-la.");
        return;
      }
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) {
        alert(data?.error ?? "Nao foi possivel criar a etiqueta.");
        return;
      }
      tag = data as TagItem;
      setTagOptions((list) => [...list, tag!].sort((a, b) => a.name.localeCompare(b.name)));
    }
    const current = selected.conversation.contactTags ?? [];
    if (current.some((t) => t.id === tag.id)) return;
    setTagEditing(false);
    await applyContactTags([...current, tag]);
  }

  async function removeContactTag(tagId: string) {
    if (!selected) return;
    const current = selected.conversation.contactTags ?? [];
    await applyContactTags(current.filter((t) => t.id !== tagId));
  }

  // ---- reacoes as mensagens (emoji); enviar vazio remove ----
  async function reactToMessage(message: MessageItem, emoji: string) {
    if (!selected) return;
    const next = message.reaction === emoji ? "" : emoji; // toggle
    const res = await fetch(`/api/conversations/${selected.conversation.id}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: message.id, emoji: next }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      alert(data?.error ?? "Nao foi possivel reagir.");
      return;
    }
    const upd = data as { id: string; reaction: string | null; reactionMine: boolean | null };
    setSelected((prev) =>
      prev
        ? {
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === upd.id ? { ...m, reaction: upd.reaction, reactionMine: upd.reactionMine } : m
            ),
          }
        : prev
    );
  }

  // transferir conversa para outro setor (ADMIN; a API ja bloqueia atende)
  async function moveToSector(sectorId: string | null) {
    if (!selected) return;
    setMovingSector(true);
    try {
      const res = await fetch(`/api/conversations/${selected.conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectorId }),
      });
      if (res.ok) {
        await loadDetail(selected.conversation.id);
        await loadList();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Nao foi possivel mover a conversa de setor.");
      }
    } finally {
      setMovingSector(false);
    }
  }

  async function uploadMedia(file: File) {
    if (!selected) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("caption", draft.trim());
      const res = await fetch(`/api/conversations/${selected.conversation.id}/media`, {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        setDraft("");
        await loadDetail(selected.conversation.id);
        await loadList();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Nao foi possivel enviar o arquivo.");
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const c = selected?.conversation;
  const canSend = c && c.status !== "CLOSED";

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-[360px_1fr] gap-4">
      {/* ---- lista de conversas ---- */}
      <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-3">
          <div className="grid grid-cols-4 gap-1 rounded-md bg-slate-100 p-1 text-xs font-medium">
            {([["ALL", "Todos"], ["PENDING", "Pendente"], ["OPEN", "Aberto"], ["CLOSED", "Encerrado"]] as const).map(
              ([s, label]) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s as StatusFilter)}
                  className={`rounded px-2 py-1 ${
                    statusFilter === s ? "bg-white shadow text-slate-900" : "text-slate-500"
                  }`}
                >
                  {label}
                </button>
              )
            )}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar contato ou telefone..."
            className="mt-2 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
          />
          <div className="mt-2 flex gap-1">
            <button
              onClick={() => {
                const next = !muted;
                setMuted(next);
                localStorage.setItem("atende_mute", next ? "1" : "0");
              }}
              title={muted ? "Ativar aviso sonoro" : "Silenciar aviso sonoro"}
              className="flex-1 rounded-md border border-slate-200 px-1 py-1 text-xs text-slate-500 hover:bg-slate-50"
            >
              {muted ? "🔇" : "🔔"}
            </button>
            <select
              value={soundName}
              onChange={(e) => {
                const v = e.target.value;
                setSoundName(v);
                localStorage.setItem("atende_sound", v);
                playSound(v); // pre-listen ao trocar
              }}
              title="Som da notificação de nova mensagem"
              className="rounded-md border border-slate-200 bg-white px-1 py-1 text-xs text-slate-500 focus:outline-none"
            >
              {SOUND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {canBulk && (
              <button
                onClick={() => {
                  setBulkMode((b) => !b);
                  setBulkSelected(new Set());
                }}
                title="Atribuição em lote (supervisor)"
                className={`rounded-md border px-3 py-1 text-xs font-semibold ${
                  bulkMode
                    ? "border-violet-500 bg-violet-100 text-violet-700"
                    : "border-slate-200 px-3 py-1 text-slate-500 hover:bg-slate-50"
                }`}
              >
                ☑ Lote
              </button>
            )}
          </div>
          {bulkMode && (
            <div className="mt-2 rounded-md border border-violet-200 bg-violet-50 p-2">
              <p className="text-[11px] font-semibold text-violet-700">
                {bulkSelected.size} conversa(s) selecionada(s) — clique para marcar
              </p>
              <div className="mt-1.5 flex items-center gap-1">
                <select
                  value=""
                  disabled={bulkApplying || bulkSelected.size === 0}
                  onChange={(e) => {
                    const uid = e.target.value;
                    e.target.value = "";
                    if (uid) void applyBulk(uid);
                  }}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 focus:border-violet-500 focus:outline-none disabled:bg-slate-100"
                >
                  <option value="">Atribuir a atendente...</option>
                  <option value="__none__">Remover atendente</option>
                  {usersList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto chat-scroll">
          {conversations.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-400">Nenhuma conversa nessa lista.</p>
          )}
          {conversations.map((item) => (
            <button
              key={item.id}
              onClick={() =>
                bulkMode ? toggleBulk(item.id) : void loadDetail(item.id)
              }
              className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                selected?.conversation.id === item.id ? "bg-sky-50" : ""
              } ${bulkMode && bulkSelected.has(item.id) ? "bg-violet-50" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-900">
                  {bulkMode ? (bulkSelected.has(item.id) ? "☑ " : "☐ ") : ""}
                  {item.contactIsGroup ? "👥 " : ""}
                  {item.contactName || item.contactPhone}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    STATUS_META[item.status].chip
                  }`}
                >
                  {STATUS_META[item.status].label}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {item.numberLabel} · {item.contactIsGroup ? "grupo" : formatPhone(item.contactPhone)}
              </p>
              <p className="mt-1 truncate text-xs text-slate-600">
                {item.status !== "CLOSED" ? (item.lastMessage || "(sem texto)") : ""}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">
                {new Date(item.lastMessageAt).toLocaleString("pt-BR")}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* ---- conversa aberta ---- */}
      <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-slate-400">
            Selecione uma conversa à esquerda
          </div>
        ) : (
          <>
            {/* inserir fonte necessarios? */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                {editingName ? (
                  <div className="flex items-center gap-1">
                    <input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveContactName(nameDraft.trim() || null);
                        if (e.key === "Escape") setEditingName(false);
                      }}
                      maxLength={120}
                      autoFocus
                      className="w-56 rounded-md border border-sky-400 px-2 py-1 text-sm focus:outline-none"
                      placeholder="Nome do contato"
                    />
                    <button
                      onClick={() => void saveContactName(nameDraft.trim() || null)}
                      className="rounded-md bg-sky-600 px-2 py-1 text-xs font-semibold text-white hover:bg-sky-700"
                    >
                      Ok
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    {c?.contactIsGroup ? "👥 " : ""}
                    {c?.contactName || c?.contactPhone}
                    {c?.contactIsGroup ? (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                        Grupo
                      </span>
                    ) : null}
                    <button
                      onClick={() => {
                        setNameDraft(c?.contactName ?? "");
                        setEditingName(true);
                      }}
                      title="Renomear contato"
                      className="text-xs text-slate-400 transition-colors hover:text-sky-600"
                    >
                      ✏️
                    </button>
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  {c?.contactIsGroup ? "grupo" : formatPhone(c?.contactPhone ?? "")} · {c?.numberLabel}
                  {c?.sectorName ? ` · ${c.sectorName}` : ""}
                  {c?.assignedUserName ? ` · Atendente: ${c.assignedUserName}` : ""}
                </p>
                {/* etiquetas do contato (Chatwoot-like) */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {(c?.contactTags ?? []).map((t) => (
                    <span
                      key={t.id}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        TAG_CHIP[t.color] ?? TAG_CHIP.slate
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${TAG_DOT[t.color] ?? TAG_DOT.slate}`} />
                      {t.name}
                      <button
                        onClick={() => void removeContactTag(t.id)}
                        title="Remover etiqueta"
                        className="opacity-60 transition-opacity hover:opacity-100"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  {tagEditing ? (
                    <>
                    <input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void addContactTag(tagInput);
                        if (e.key === "Escape") setTagEditing(false);
                      }}
                      maxLength={40}
                      autoFocus
                      list="tag-options"
                      placeholder="Nova etiqueta + Enter"
                      className="w-40 rounded-md border border-sky-400 px-2 py-0.5 text-[11px] focus:outline-none"
                    />
                    <datalist id="tag-options">
                      {tagOptions.map((t) => (
                        <option key={t.id} value={t.name} />
                      ))}
                    </datalist>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setTagInput("");
                        setTagEditing(true);
                      }}
                      title="Adicionar etiqueta ao contato"
                      className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-400 hover:border-sky-400 hover:text-sky-600"
                    >
                      ＋ etiqueta
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {me?.role === "ADMIN" && (
                  <select
                    value={c?.sectorId ?? ""}
                    onChange={(e) => void moveToSector(e.target.value || null)}
                    disabled={movingSector}
                    className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 focus:border-sky-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                    title="Transferir para setor"
                  >
                    <option value="">Sem setor (empresa)</option>
                    {sectorsList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  value={c?.assignedUserId ?? ""}
                  onChange={(e) => void assignTo(e.target.value || null)}
                  disabled={c?.status === "CLOSED"}
                  className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 focus:border-sky-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                  title="Transferir para atendente"
                >
                  <option value="">Sem atendente</option>
                  {usersList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                {c?.status === "PENDING" && (
                  <button
                    onClick={() => void act("take")}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    Iniciar atendimento
                  </button>
                )}
                {c?.status === "OPEN" && (
                  <button
                    onClick={() => void act("close")}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Encerrar conversa
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-5 chat-scroll">
              {selected.messages.map((m) => (
                <MessageBubble key={m.id} message={m} onReact={reactToMessage} onOpenImage={setViewerSrc} />
              ))}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={send} className="relative flex gap-2 border-t border-slate-100 p-3">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,video/*,audio/*,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadMedia(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!canSend || uploading}
                title="Anexar imagem, documento, áudio ou vídeo (até 25 MB)"
                className="rounded-md border border-slate-300 px-3 text-base text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {uploading ? "⏳" : "📎"}
              </button>
              <button
                type="button"
                onClick={() => setRepliesOpen((o) => !o)}
                title="Respostas rápidas"
                className="rounded-md border border-slate-300 px-3 text-base text-slate-600 hover:bg-slate-50"
              >
                ⚡
              </button>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={(e) => void handlePaste(e)}
                placeholder={
                  canSend ? "Escreva a mensagem e pressione Enter..." : "Conversa encerrada"
                }
                disabled={!canSend || sending || uploading}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
              />
              <button
                type="submit"
                disabled={!canSend || sending || uploading || !draft.trim()}
                className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                Enviar
              </button>
              {repliesOpen && (
                <div className="absolute bottom-16 right-8 z-10 max-h-[40vh] w-96 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {quickReplies.length === 0 ? (
                    <p className="p-3 text-xs text-slate-400">Nenhuma resposta rápida disponível.</p>
                  ) : (
                    quickReplies.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          setDraft(r.content);
                          setRepliesOpen(false);
                        }}
                        className="block w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-sky-50"
                      >
                        <span className="font-mono text-[11px] font-semibold text-sky-700">
                          {r.shortcut}
                        </span>
                        <span className="ml-2 text-[11px] text-slate-400">{r.sectorName ?? "todos"}</span>
                        <p className="truncate text-xs text-slate-600">{r.content}</p>
                      </button>
                    ))
                  )}
                </div>
              )}
            </form>
          </>
        )}
      </div>
      {/* visualizador de imagem: tela cheia com zoom + arraste */}
      {viewerSrc ? <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} /> : null}
    </div>
  );
}

/**
 * Visualizador de imagem em tela cheia (quando a foto da bolha fica pequena).
 * Zoom: roda do mouse ou botoes +/−; arraste p/ navegar; duplo clique/Esc
 * reseta/fecha. Fundo escuro para dar contraste na foto.
 */
function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const zoomBy = (factor: number) =>
    setScale((s) => Math.min(8, Math.max(1, s * factor)));
  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  // roda do mouse = zoom (preciso de listener nao-passivo p/ preventDefault)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-") zoomBy(1 / 1.25);
      else if (e.key === "0") reset();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // troca de imagem: zoom e posicao zerados
  useEffect(() => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  }, [src]);

  return (
    <div
      ref={wrapRef}
      onClick={onClose}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
        try {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {
          /* pointer capture opcional */
        }
      }}
      onPointerMove={(e) => {
        if (!drag.current || scale === 1) return;
        setPos({
          x: drag.current.ox + (e.clientX - drag.current.x),
          y: drag.current.oy + (e.clientY - drag.current.y),
        });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      className="viewer-backdrop fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/90 backdrop-blur-sm"
    >
      {/* moldura: a animacao de entrada fica aqui e o zoom/arraste no <img> */}
      <figure
        className="viewer-frame pointer-events-auto m-auto max-h-full max-w-full"
        style={{ animationDelay: "0.02s" }}
      >
        <img
          src={src}
          alt="imagem ampliada"
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={reset}
          className="max-h-full max-w-full select-none rounded-md shadow-2xl shadow-black/60"
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
            cursor: scale > 1 ? "grab" : "zoom-in",
          }}
        />
      </figure>

      {/* fechar (canto superior direito) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Fechar (Esc)"
        className="viewer-btn absolute right-4 top-4 h-10 w-10 text-xl leading-none"
      >
        ✕
      </button>

      {/* barra de acoes (vidro, rodape central) */}
      <div
        className="viewer-btn absolute bottom-5 left-1/2 flex -translate-x-1/2 divide-x divide-white/10"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => zoomBy(1 / 1.25)}
          disabled={scale <= 1}
          title="Diminuir zoom"
          className="h-11 w-11 text-lg leading-none transition-opacity disabled:opacity-30"
        >
          −
        </button>
        <button
          onClick={reset}
          title="Resetar zoom (0)"
          className="h-11 w-16 text-xs font-semibold tabular-nums"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={() => zoomBy(1.25)}
          disabled={scale >= 8}
          title="Aumentar zoom"
          className="h-11 w-11 text-lg leading-none transition-opacity disabled:opacity-30"
        >
          +
        </button>
        <a
          href={`${src}?download=1`}
          title="Baixar imagem"
          className="flex h-11 w-11 items-center justify-center text-lg leading-none"
        >
          ⬇
        </a>
      </div>

      {/* dica de uso */}
      <p className="viewer-btn absolute bottom-5 left-4 hidden px-3 py-1.5 text-[11px] md:block">
        roda = zoom · arraste = mover · duplo clique = reset
      </p>
    </div>
  );
}

function playBeep() {
  playSound("classico");
}

// sons de notificacao sintetizados (sem arquivos externos)
export const SOUND_OPTIONS = [
  { value: "classico", label: "Clássico" },
  { value: "ping", label: "Ping" },
  { value: "campainha", label: "Campainha" },
  { value: "pop", label: "Pop" },
] as const;

function playSound(name: string) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume();
    const t0 = ctx.currentTime;
    const beep = (
      freq: number,
      at: number,
      dur: number,
      type: OscillatorType = "sine",
      vol = 0.06
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur);
    };
    switch (name) {
      case "ping":
        beep(880, 0, 0.12);
        beep(1320, 0.12, 0.16);
        break;
      case "campainha":
        beep(784, 0, 0.5, "triangle", 0.05);
        beep(1046, 0.02, 0.5, "triangle", 0.035);
        break;
      case "pop":
        beep(300, 0, 0.07, "square", 0.045);
        beep(240, 0.1, 0.07, "square", 0.045);
        break;
      default: // classico
        beep(880, 0, 0.35);
    }
    setTimeout(() => void ctx.close(), 900);
  } catch {
    /* ambiente sem suporte a audio */
  }
}

function MessageBubble({
  message,
  onReact,
  onOpenImage,
}: {
  message: MessageItem;
  onReact?: (message: MessageItem, emoji: string) => void;
  onOpenImage?: (src: string) => void;
}) {
  const isOut = message.direction === "OUTGOING";

  let body: React.ReactNode = null;
  if (message.mediaUrl) {
    const src = `/api/media/${message.mediaUrl}`;
    if (message.mediaType?.startsWith("image/")) {
      body = (
        <img
          src={src}
          alt={message.fileName ?? "imagem"}
          loading="lazy"
          // clique abre o visualizador (zoom + foto em tela cheia)
          onClick={() => onOpenImage?.(src)}
          className="-mb-1 max-w-[240px] cursor-zoom-in rounded-md hover:opacity-90"
        />
      );
    } else if (message.mediaType?.startsWith("video/")) {
      body = <video src={src} controls className="max-w-[240px] rounded-md" />;
    } else if (message.mediaType?.startsWith("audio/")) {
      body = <audio src={src} controls className="w-[240px]" />;
    } else {
      body = (
        <a
          href={`${src}?download=1`}
          className="flex items-center gap-2 font-medium text-sky-700 underline"
        >
          📄 {message.fileName ?? "Arquivo anexado"}
        </a>
      );
    }
  }
  if (message.content) {
    body = (
      <>
        {body}
        <p className="mt-1 whitespace-pre-wrap break-words">{message.content}</p>
      </>
    );
  }
  if (!body) body = <p className="italic text-slate-500">(mensagem sem conteúdo)</p>;

  return (
    <div className={`group mb-1.5 flex ${isOut ? "justify-end" : "justify-start"}`}>
      {/* o limite de largura fica AQUI (containing block com largura definida):
          em um wrapper shrink-to-fit o % não resolve e a bolha estoura/quebra errado */}
      <div className="relative max-w-[70%]">
        <div
          className={`rounded-lg border px-3 py-2 text-sm shadow-sm ${
            isOut
              ? "border-emerald-300 bg-emerald-200 text-slate-900"
              : "border-slate-300 bg-slate-200 text-slate-900"
          }`}
        >
          {/* resposta citando outra mensagem ("responder" do WhatsApp) */}
          {message.quotedSnippet ? (
            <div className="mb-1 rounded-l border-l-4 border-slate-400 bg-slate-100 px-2 py-1">
              <p className="text-[10px] font-semibold text-slate-600">
                {message.quotedSender ? formatPhone(message.quotedSender) : "Mensagem citada"}
              </p>
              <p className="whitespace-pre-wrap break-words text-[11px] text-slate-600">
                {message.quotedSnippet}
              </p>
            </div>
          ) : null}
          {/* grupo: nome do participante que enviou (nao aparece nas suas) */}
          {!isOut && message.senderName ? (
            <p className="mb-0.5 text-[11px] font-semibold text-sky-700">{message.senderName}</p>
          ) : null}
          {body}
          <p
            className={`mt-1 text-right text-[10px] ${
              message.status === "FAILED" ? "font-semibold text-rose-600" : "text-slate-500"
            }`}
          >
            {message.status === "FAILED" ? "falhou · " : ""}
            {new Date(message.createdAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        {/* reacao existente: chip clicavel (reagir de novo remove) */}
        {message.reaction ? (
          <button
            onClick={() => onReact?.(message, message.reaction ?? "")}
            title="Reação — clique para remover"
            className={`absolute bottom-0 flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] shadow-sm ${
              isOut ? "-left-2" : "-right-2"
            }`}
          >
            {message.reaction}
          </button>
        ) : (
          /* emojis rapidos no hover */
          onReact && (
            <div
              className={`absolute top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 ${
                isOut ? "-left-2" : "-right-2"
              }`}
            >
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => onReact(message, e)}
                  className="px-0.5 text-sm transition-transform hover:scale-110"
                  title={`Reagir ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
