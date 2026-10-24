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
  numberLabel: string;
  sectorName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
};

type MessageItem = {
  id: string;
  direction: "INCOMING" | "OUTGOING";
  content: string;
  createdAt: string;
  status: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  fileName?: string | null;
};

type UserOption = { id: string; name: string };

type ConversationDetail = {
  conversation: ConversationItem;
  messages: MessageItem[];
};

const STATUS_META: Record<Status, { label: string; chip: string }> = {
  PENDING: { label: "Pendente", chip: "bg-amber-100 text-amber-700" },
  OPEN: { label: "Aberto", chip: "bg-emerald-100 text-emerald-700" },
  CLOSED: { label: "Encerrado", chip: "bg-slate-100 text-slate-600" },
};

export default function InboxClient() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING");
  const [query, setQuery] = useState("");
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [usersList, setUsersList] = useState<UserOption[]>([]);
  const [muted, setMuted] = useState(false);
  const [uploading, setUploading] = useState(false);
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
    void fetch("/api/users")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: UserOption[]) => setUsersList(list));
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
            playBeep();
          }
          void loadList();
        }
        if (evt.type === "conversation:update") {
          void loadList();
        }
      } catch {
        /* ignora eventos malformados */
      }
    };
    return () => source.close();
  }, [loadList, loadDetail, muted]);

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
          <button
            onClick={() => {
              const next = !muted;
              setMuted(next);
              localStorage.setItem("atende_mute", next ? "1" : "0");
            }}
            title={muted ? "Ativar aviso sonoro" : "Silenciar aviso sonoro"}
            className="mt-2 w-full rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50"
          >
            {muted ? "🔇 Aviso sonoro desligado" : "🔔 Aviso sonoro ligado"}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto chat-scroll">
          {conversations.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-400">Nenhuma conversa nessa lista.</p>
          )}
          {conversations.map((item) => (
            <button
              key={item.id}
              onClick={() => void loadDetail(item.id)}
              className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                selected?.conversation.id === item.id ? "bg-sky-50" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-900">
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
                {item.numberLabel} · {item.contactPhone}
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
                <p className="text-sm font-semibold text-slate-900">
                  {c?.contactName || c?.contactPhone}
                </p>
                <p className="text-xs text-slate-500">
                  {c?.contactPhone} · {c?.numberLabel}
                  {c?.sectorName ? ` · ${c.sectorName}` : ""}
                  {c?.assignedUserName ? ` · Atendente: ${c.assignedUserName}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
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
                <MessageBubble key={m.id} message={m} />
              ))}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={send} className="flex gap-2 border-t border-slate-100 p-3">
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
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
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
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function playBeep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    setTimeout(() => void ctx.close(), 500);
  } catch {
    /* ambiente sem suporte a audio */
  }
}

function MessageBubble({ message }: { message: MessageItem }) {
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
          className="-mb-1 max-w-[240px] rounded-md"
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
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[70%] rounded-lg border px-3 py-2 text-sm shadow-sm ${
          isOut
            ? "border-emerald-300 bg-emerald-200 text-slate-900"
            : "border-slate-300 bg-slate-200 text-slate-900"
        }`}
      >
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
    </div>
  );
}
