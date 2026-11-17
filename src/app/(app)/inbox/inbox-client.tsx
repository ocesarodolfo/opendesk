"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageBubble, MessageList } from "./components/MessageBubble";
import { ToastHost, showToast } from "@/components/toast";
import { getMute, getSound, playSound, SOUND_EVENT, type SoundName } from "@/components/notif-sound";
import {
  IconCheckboxOn,
  IconCheckboxOff,
  IconUsers,
  IconPencil,
  IconPaperclip,
  IconBolt,
  IconDownload,
  IconX,
} from "@/components/icons";

type Status = "PENDING" | "OPEN" | "CLOSED";
type StatusFilter = Status | "ALL";
type QuickFilter = "ALL" | "MINE" | "UNASSIGNED" | "UNREAD";

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
  prefixAgent?: boolean;
  sectorId: string | null;
  sectorName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  /** mensagens recebidas ainda nao vistas por atendente (badge "nao lidas") */
  unreadCount?: number;
  contactTags?: TagItem[];
};

type TagItem = { id: string; name: string; color: string };

// tipo da bolha e componente visuais vivem em ./components/MessageBubble
import type { MessageItem } from "./components/MessageBubble";

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

// Exibe o numero de telefone BR como +55 (DDD) 00000-0000 (quando reconhecido)
function formatPhone(d: string): string {
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d}`;
}

// Timestamp compacto para a lista (hoje: HH:mm, ontem: Ontem, ano: dd/MM, antigo: dd/MM/yy)
function formatShortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86400000);
  if (diffDays === 0) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Ontem";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
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
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("ALL");
  const [tagFilter, setTagFilter] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  // carga em progresso para os skeletons (lista e detalhe)
  const [listLoading, setListLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  // modo resposta: barra acima do composer com a mensagem citada (pragmatico —
  // Baileys 6.x usa a stanza da mensagem original para cotar no WA; guardamos
  // a citacao no lado do painel)
  const [replyTo, setReplyTo] = useState<{ name: string; snippet: string } | null>(null);
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
  const [replyIndex, setReplyIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<
    { id: string; file: File; previewUrl: string | null }[]
  >([]);
  const [dragActive, setDragActive] = useState(false);
  const [tagOptions, setTagOptions] = useState<TagItem[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagEditing, setTagEditing] = useState(false);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const draftsRef = useRef<Record<string, string>>({});
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const pendingFilesRef = useRef(pendingFiles);
  pendingFilesRef.current = pendingFiles;

  // mantem o id da conversa aberta acessivel no listener SSE
  // (evita reconectar o EventSource a cada selecao)
  const selectedIdRef = useRef<string | null>(null);
  // "ja carregou a lista uma vez (com sucesso)"? depois disso, fim do skeleton
  const firstLoadedRef = useRef(false);
  useEffect(() => {
    selectedIdRef.current = selected?.conversation.id ?? null;
  }, [selected]);

  useEffect(() => {
    setMuted(getMute());
    setSoundName(getSound());
    // sincroniza com o menu do perfil (mesma origem: localStorage + evento)
    const sync = () => {
      setMuted(getMute());
      setSoundName(getSound());
    };
    window.addEventListener(SOUND_EVENT, sync);
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
    return () => window.removeEventListener(SOUND_EVENT, sync);
  }, []);

  // debounce na busca para evitar requisicoes a cada tecla
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // atalhos globais: Ctrl/Cmd+K foca a busca; Esc fecha painel de detalhes
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === "Escape" && detailsOpen) {
        setDetailsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailsOpen]);

  const loadList = useCallback(async (opts?: { cache?: boolean }) => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    const qs = params.toString();
    const cacheKey = `atende_conv_cache:${statusFilter}${debouncedQuery.trim() ? `|${debouncedQuery.trim()}` : ""}`;
    setListLoading(true);
    // cache local: renderiza a lista na hora (stale-while-revalidate)
    if (opts?.cache) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) setConversations(JSON.parse(cached) as ConversationItem[]);
      } catch {
        /* cache invalido/indisponivel: ignora */
      }
    }
    const res = await fetch(`/api/conversations${qs ? `?${qs}` : ""}`);
    if (res.ok) {
      const data = (await res.json()) as ConversationItem[];
      setConversations(data);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch {
        /* sem espaco: ignora */
      }
    }
    // verdeiro "ja carregou uma vez": depois da 1a carga com sucesso, nunca
    // mais skeleton (o vidro nunca fica vazio — mostra o anterior e revalida)
    if (res.ok) firstLoadedRef.current = true;
    setListLoading(false);
  }, [statusFilter, debouncedQuery]);

  const loadDetail = useCallback(async (id: string, opts?: { cache?: boolean }) => {
    setRepliesOpen(false);
    setEditingName(false);
    setReplyTo(null);
    // cache local: mensagens aparecem instantaneamente ao abrir a conversa
    if (opts?.cache) {
      try {
        const cached = localStorage.getItem(`atende_detail_cache:${id}`);
        if (cached) setSelected(JSON.parse(cached) as ConversationDetail);
      } catch {
        /* cache invalido: ignora */
      }
    }
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) {
      const data = (await res.json()) as ConversationDetail;
      setSelected(data);
      try {
        localStorage.setItem(`atende_detail_cache:${id}`, JSON.stringify(data));
      } catch {
        /* sem espaco: ignora */
      }
    } else if (!opts?.cache) {
      setSelected(null); // sem cache: mostra o vazio (pane detalhe vira skeleton)
    }
  }, []);

  // Carrega lista ao filtrar/buscar (com cache local: lista instantanea)
  useEffect(() => {
    void loadList({ cache: true });
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
            // conversa aberta em foco = mensagem nova ja lida pelo atendente
            void fetch(`/api/conversations/${evt.conversationId}/read`, { method: "POST" }).catch(
              () => null
            );
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
          // reacao/status: atualiza a bolha em tela sem recarregar tudo
          const upd = evt.message as {
            id: string;
            reaction?: string | null;
            reactionMine?: boolean | null;
            status?: string;
            deleted?: boolean;
          };
          setSelected((prev) =>
            prev && prev.conversation.id === evt.conversationId
              ? {
                  ...prev,
                  messages: prev.messages.map((m) =>
                    m.id === upd.id
                      ? {
                          ...m,
                          reaction: upd.reaction !== undefined ? upd.reaction : m.reaction,
                          reactionMine: upd.reactionMine !== undefined ? upd.reactionMine : m.reactionMine,
                          status: upd.status ?? m.status,
                          deleted: upd.deleted ?? m.deleted,
                        }
                      : m
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

  // rolar ao fim: instantaneo. "Colar no rodape": ao abrir qualquer conversa
  // o usuario vai direto para a mensagem mais recente; mensagens novas só
  // arrastam a view se ele ja estava no rodape (como o WhatsApp faz)
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickBottomRef.current = nearBottom;
    setShowScrollBottom(!nearBottom);
  }, []);

  function scrollToBottom(smooth = true) {
    stickBottomRef.current = true;
    setShowScrollBottom(false);
    bottomRef.current?.scrollIntoView({
      behavior: (smooth ? "smooth" : "instant") as ScrollBehavior,
    });
  }

  // limpa object URLs ao desmontar
  useEffect(() => {
    return () => {
      pendingFilesRef.current.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
    };
  }, []);

  // auto-resize do textarea conforme o texto digitado
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, selected?.conversation.id]);

  function clearPendingFiles() {
    setPendingFiles((prev) => {
      prev.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      return [];
    });
  }

  function removePendingFile(id: string) {
    setPendingFiles((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  function stageFiles(fileList: FileList | File[]) {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    const valid: { id: string; file: File; previewUrl: string | null }[] = [];
    for (const f of arr) {
      if (f.size === 0) {
        showToast(`Arquivo vazio ignorado: ${f.name}`, "erro");
        continue;
      }
      if (f.size > 25 * 1024 * 1024) {
        showToast(`${f.name} excede o limite de 25 MB.`, "erro");
        continue;
      }
      valid.push({
        id: crypto.randomUUID(),
        file: f,
        previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      });
    }
    if (valid.length > 0) {
      setPendingFiles((prev) => [...prev, ...valid]);
      setTimeout(() => composerRef.current?.focus(), 0);
    }
  }

  // troca de conversa: sempre vai ao fim, sem animacao
  useEffect(() => {
    stickBottomRef.current = true;
    setShowScrollBottom(false);
    bottomRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
  }, [selected?.conversation.id]);

  // mensagem nova: so rola se o usuario ja estava no rodape
  useEffect(() => {
    if (!selected) return;
    if (stickBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    }
  }, [selected?.messages.length]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!selected || !canSend) return;
    if (pendingFiles.length > 0) {
      await sendPendingFiles();
      return;
    }
    const text = draft.trim();
    if (!text) return;
    const convId = selected.conversation.id;
    const conv = selected.conversation;
    // envio otimista: bolha aparece na hora (com prefixo do atendente, se ativo),
    // com relogio de "enviando" ate a confirmacao do servidor
    // prefixo do atendente em LINHA PROPRIA: "[Nome]\n resto da mensagem"
    const prefix = conv.prefixAgent && me?.name ? `[${me.name}]\n` : "";
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const temp: MessageItem = {
      id: tempId,
      direction: "OUTGOING",
      content: `${prefix}${text}`,
      createdAt: new Date().toISOString(),
      status: "SENT",
      pending: true,
      quotedSnippet: replyTo?.snippet ?? undefined,
      quotedSenderName: replyTo?.name ?? undefined,
    };
    setSelected((prev) =>
      prev && prev.conversation.id === convId
        ? { ...prev, messages: [...prev.messages, temp] }
        : prev
    );
    setDraft("");
    delete draftsRef.current[convId];
    const reply = replyTo;
    setReplyTo(null);
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          replyName: reply?.name ?? null,
          replySnippet: reply?.snippet ?? null,
        }),
      });
      if (res.ok) {
        await loadDetail(convId); // substitui a bolha temporaria pela persistida
        await loadList();
      } else {
        // falha: remove a bolha otimista
        setSelected((prev) =>
          prev && prev.conversation.id === convId
            ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempId) }
            : prev
        );
        const data = await res.json().catch(() => null);
        showToast(data?.error ?? "Nao foi possivel enviar a mensagem.", "erro");
      }
    } catch {
      setSelected((prev) =>
        prev && prev.conversation.id === convId
          ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempId) }
          : prev
      );
    } finally {
      setSending(false);
    }
  }

  // abre conversa: salva rascunho anterior, restaura rascunho da nova e carrega
  function openConversation(item: ConversationItem) {
    const prevId = selectedIdRef.current;
    if (prevId) {
      if (draftRef.current.trim()) draftsRef.current[prevId] = draftRef.current;
      else delete draftsRef.current[prevId];
    }
    setDraft(draftsRef.current[item.id] ?? "");
    clearPendingFiles();
    setSelected(null);
    setOpeningId(item.id);
    // abriu = leu no painel (badges zeram, como no WhatsApp)
    void fetch(`/api/conversations/${item.id}/read`, { method: "POST" })
      .then((r) => (r.ok ? loadList() : null))
      .catch(() => null);
    void loadDetail(item.id, { cache: true }).then(() => setOpeningId(null));
  }

  // abre o modo resposta no composer (menu de acoes das bolhas)
  function startReply(message: MessageItem) {
    const name =
      message.direction === "OUTGOING" ? "Você" : message.senderName ?? "Contato";
    setReplyTo({
      name,
      snippet:
        (message.content || message.fileName || "Mídia").slice(0, 120),
    });
    setTimeout(() => composerRef.current?.focus(), 0);
  }

  // "Apagar para todos": revoke no WhatsApp + marca no banco
  async function deleteForAll(message: MessageItem) {
    if (!selected) return;
    if (!confirm("Apagar esta mensagem para todos no WhatsApp?")) return;
    const convId = selected.conversation.id;
    const res = await fetch(
      `/api/conversations/${convId}/messages?messageId=${encodeURIComponent(message.id)}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      showToast("Mensagem apagada para todos.", "sucesso");
      await loadDetail(convId);
      await loadList();
    } else {
      const data = await res.json().catch(() => null);
      showToast(data?.error ?? "Nao foi possivel apagar a mensagem.", "erro");
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
      showToast("Nao foi possivel transferir a conversa.", "erro");
    }
  }

  // Colar (Ctrl+V) arquivos da area de transferencia prepara o envio agrupado
  // com preview — como o WhatsApp Web faz. Texto colado segue o caminho normal.
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!canSend || uploading) return;
    const files = Array.from(e.clipboardData.files ?? []).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/") || f.type.startsWith("audio/")
    );
    if (files.length > 0) {
      e.preventDefault();
      stageFiles(files);
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
        showToast(data?.error ?? "Nao foi possivel atribuir em lote.", "erro");
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
      showToast("Nao foi possivel salvar o nome do contato.", "erro");
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
      showToast("Nao foi possivel salvar as etiquetas do contato.", "erro");
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
        showToast("Etiqueta inexistente. Peça a um administrador para criá-la.", "erro");
        return;
      }
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) {
        showToast(data?.error ?? "Nao foi possivel criar a etiqueta.", "erro");
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
      showToast(data?.error ?? "Nao foi possivel reagir.", "erro");
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
        showToast(data?.error ?? "Nao foi possivel mover a conversa de setor.", "erro");
      }
    } finally {
      setMovingSector(false);
    }
  }

  // envia os arquivos agrupados (1 ou mais) com legenda opcional, como no WhatsApp
  async function sendPendingFiles() {
    if (!selected || pendingFiles.length === 0) return;
    const convId = selected.conversation.id;
    const items = [...pendingFiles];
    const caption = draft.trim();
    const groupKey = items.length > 1 ? crypto.randomUUID().slice(0, 8) : null;

    setUploading(true);
    clearPendingFiles();
    setDraft("");
    delete draftsRef.current[convId];

    let failed = false;
    try {
      for (let i = 0; i < items.length; i++) {
        const { file } = items[i];
        setSelected((prev) =>
          prev && prev.conversation.id === convId
            ? {
                ...prev,
                messages: [
                  ...prev.messages,
                  {
                    id: `tmp-${groupKey ?? "single"}-${i}`,
                    direction: "OUTGOING" as const,
                    content: i === 0 ? caption : "",
                    createdAt: new Date().toISOString(),
                    status: "SENT",
                    pending: true,
                    mediaType: file.type,
                    fileName: file.name,
                    mediaUrl: null,
                    groupKey,
                  },
                ],
              }
            : prev
        );
        const form = new FormData();
        form.set("file", file);
        // legenda vai apenas no primeiro arquivo do grupo para nao repetir no WhatsApp
        form.set("caption", i === 0 ? caption : "");
        if (groupKey) form.set("groupKey", groupKey);

        const res = await fetch(`/api/conversations/${convId}/media`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          showToast(data?.error ?? `Falha ao enviar ${file.name}.`, "erro");
          failed = true;
          break;
        }
      }
      await loadDetail(convId);
      await loadList();
      if (!failed && items.length > 1) {
        showToast(`${items.length} arquivos enviados.`, "sucesso");
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const c = selected?.conversation;
  const canSend = Boolean(c && c.status !== "CLOSED");

  // resposta rapida: aciona ao digitar "/..." no inicio ou pelo botao de raio
  const slashMatch = draft.match(/^\/([^\s\n]*)$/);
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : "";
  const isSlashOpen = Boolean(canSend && slashMatch);
  const showReplies = Boolean(canSend && (repliesOpen || isSlashOpen));
  const filteredQuickReplies = slashMatch
    ? quickReplies.filter(
        (r) =>
          r.shortcut.toLowerCase().includes(slashQuery) ||
          r.content.toLowerCase().includes(slashQuery)
      )
    : quickReplies;

  function applyQuickReply(r: Reply) {
    setDraft(r.content);
    setRepliesOpen(false);
    setReplyIndex(0);
    setTimeout(() => composerRef.current?.focus(), 0);
  }

  // filtros rapidos client-side sobre a lista carregada
  const visibleConversations = conversations.filter((item) => {
    if (quickFilter === "MINE" && item.assignedUserId !== me?.id) return false;
    if (quickFilter === "UNASSIGNED" && item.assignedUserId !== null) return false;
    if (quickFilter === "UNREAD" && (item.unreadCount ?? 0) === 0) return false;
    if (tagFilter && !(item.contactTags ?? []).some((t) => t.id === tagFilter)) return false;
    return true;
  });

  return (
    <div className="grid h-[calc(100dvh-5.5rem)] min-w-0 grid-cols-1 gap-4 overflow-hidden sm:h-[calc(100dvh-6.5rem)] md:h-[calc(100dvh-4rem)] lg:grid-cols-[360px_minmax(0,1fr)]">
      {/* ---- lista de conversas ---- */}
      <div
        className={`${
          selected || openingId ? "hidden lg:flex" : "flex"
        } flex-col overflow-hidden rounded-lg border border-slate-200 bg-white`}
      >
        <div className="border-b border-slate-100 p-3">
          <div className="grid grid-cols-4 gap-1 rounded-md bg-slate-100 p-1 text-xs font-medium">
            {([["ALL", "Todos"], ["PENDING", "Pendente"], ["OPEN", "Aberto"], ["CLOSED", "Encerrado"]] as const).map(
              ([s, label]) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s as StatusFilter)}
                  className={`rounded px-1.5 py-1 ${
                    statusFilter === s ? "bg-white shadow text-slate-900" : "text-slate-500"
                  }`}
                >
                  {label}
                  {statusFilter === s ? (
                    <span className="ml-1 text-[10px] text-slate-400">
                      ({visibleConversations.length})
                    </span>
                  ) : null}
                </button>
              )
            )}
          </div>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar contato ou telefone (Ctrl+K)..."
            className="mt-2 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {(
              [
                ["ALL", "Todas"],
                ["MINE", "Minhas"],
                ["UNASSIGNED", "Sem atendente"],
                ["UNREAD", "Não lidas"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setQuickFilter(k)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  quickFilter === k
                    ? "bg-sky-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
            {tagOptions.length > 0 && (
              <select
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                title="Filtrar por etiqueta"
                className="ml-auto max-w-[110px] rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 focus:border-sky-500 focus:outline-none"
              >
                <option value="">Etiqueta...</option>
                {tagOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            {canBulk && (
              <button
                onClick={() => {
                  setBulkMode((b) => !b);
                  setBulkSelected(new Set());
                }}
                title="Atribuição em lote (supervisor)"
                className={`rounded-md border px-2.5 py-0.5 text-[11px] font-semibold ${
                  bulkMode
                    ? "border-violet-500 bg-violet-100 text-violet-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <IconCheckboxOn className="inline h-3.5 w-3.5 align-[-2px] text-violet-600" /> Lote
              </button>
            )}
          </div>
          {bulkMode && (
            <div className="mt-2 rounded-md border border-violet-200 bg-violet-50 p-2">
              <p className="text-xs font-semibold text-violet-700">
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
          {listLoading && conversations.length === 0 && !firstLoadedRef.current
            ? // skeleton: SO na primeira carga da sessao (sem cache/fetch ainda);
              // depois disso nunca sobra vazio nem skeleton
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="animate-pulse border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="h-3.5 w-36 rounded bg-slate-200" />
                    <div className="h-4 w-16 rounded-full bg-slate-200" />
                  </div>
                  <div className="mt-2 h-2.5 w-48 rounded bg-slate-200" />
                  <div className="mt-2 h-2.5 w-40 rounded bg-slate-100" />
                </div>
              ))
            : null}
          {!listLoading && visibleConversations.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-400">Nenhuma conversa nessa lista.</p>
          )}
          {visibleConversations.map((item) => (
            <button
              key={item.id}
              onClick={() =>
                bulkMode ? toggleBulk(item.id) : void openConversation(item)
              }
              className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition-colors ${
                selected?.conversation.id === item.id
                  ? "bg-sky-50 hover:bg-sky-100/70" // aberta: realce azul permanente, hover aprofunda
                  : item.status === "CLOSED"
                    ? "hover:bg-slate-50 opacity-70" // encerrada: esmaecida no repouso
                    : "hover:bg-slate-50"
              } ${bulkMode && bulkSelected.has(item.id) ? "bg-violet-50" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`truncate text-sm text-slate-900 ${
                    (item.unreadCount ?? 0) > 0 ? "font-bold" : "font-medium"
                  }`}
                >
                  {bulkMode ? (
                    bulkSelected.has(item.id) ? (
                      <IconCheckboxOn className="mr-1 inline h-4 w-4 align-[-3px]" />
                    ) : (
                      <IconCheckboxOff className="mr-1 inline h-4 w-4 align-[-3px] text-slate-400" />
                    )
                  ) : null}
                  {item.contactIsGroup ? (
                    <IconUsers className="mr-1 inline h-4 w-4 align-[-3px]" />
                  ) : null}
                  {item.contactName || item.contactPhone}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    STATUS_META[item.status].chip
                  }`}
                >
                  {STATUS_META[item.status].label}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {item.numberLabel} · {item.contactIsGroup ? "grupo" : formatPhone(item.contactPhone)}
              </p>
              <p
                className={`mt-1 truncate text-xs ${
                  (item.unreadCount ?? 0) > 0 ? "font-semibold text-slate-800" : "text-slate-600"
                }`}
              >
                {item.status !== "CLOSED" ? (item.lastMessage || "(sem texto)") : ""}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p
                  className="truncate text-xs text-slate-400"
                  title={new Date(item.lastMessageAt).toLocaleString("pt-BR")}
                >
                  {formatShortTime(item.lastMessageAt)}
                </p>
                {/* nao lidas: bolinha/chip verde como no WhatsApp */}
                {(item.unreadCount ?? 0) > 0 ? (
                  <span
                    className="inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold leading-4 text-white"
                    title={`${item.unreadCount} mensagem(ns) nao lida(s)`}
                  >
                    {(item.unreadCount ?? 0) > 99 ? "99+" : item.unreadCount}
                  </span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ---- conversa aberta ---- */}
      <div
        onDragOver={(e) => {
          if (!canSend || uploading) return;
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragActive(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragActive(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (!canSend || uploading) return;
          if (e.dataTransfer.files?.length) {
            stageFiles(e.dataTransfer.files);
          }
        }}
        className={`${
          !selected && !openingId ? "hidden lg:flex" : "flex"
        } relative min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white`}
      >
        {dragActive && canSend ? (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-sky-500 bg-sky-50/90 backdrop-blur-[1px]">
            <div className="rounded-lg bg-white px-5 py-3 text-center shadow-sm">
              <p className="text-sm font-semibold text-sky-700">Solte os arquivos aqui para anexar</p>
              <p className="text-xs text-slate-500">Eles serão agrupados antes do envio</p>
            </div>
          </div>
        ) : null}
        {!selected ? (
          openingId ? (
            /* skeleton do detalhe: cabecalho + bolhas pulsando na corredor */
            <div className="flex flex-1 flex-col p-5">
              <div className="mb-5 flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-slate-200" />
                <div className="h-3.5 w-40 rounded bg-slate-200" />
              </div>
              <div className="flex-1 animate-pulse space-y-3">
                <div className="ml-auto h-10 w-2/5 rounded-xl bg-slate-200" />
                <div className="mr-auto h-10 w-1/3 rounded-xl bg-slate-100" />
                <div className="ml-auto h-14 w-1/2 rounded-xl bg-slate-200" />
                <div className="mr-auto h-10 w-2/5 rounded-xl bg-slate-100" />
                <div className="ml-auto h-10 w-1/4 rounded-xl bg-slate-200" />
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-slate-400">
              Selecione uma conversa à esquerda
            </div>
          )
        ) : (
          <>
            {/* cabecalho: limpo e focado na acao imediata */}
            <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setDetailsOpen(false);
                  }}
                  title="Voltar para a lista"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 lg:hidden"
                >
                  ←
                </button>
                <div className="min-w-0">
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
                        <IconX className="inline h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-900">
                      {c?.contactIsGroup ? <IconUsers className="h-4 w-4 shrink-0" /> : null}
                      <span className="truncate">{c?.contactName || c?.contactPhone}</span>
                      {c?.contactIsGroup ? (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
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
                        <IconPencil className="inline h-3.5 w-3.5" />
                      </button>
                    </p>
                  )}
                  <p className="truncate text-xs text-slate-500">
                    {c?.contactIsGroup ? "grupo" : formatPhone(c?.contactPhone ?? "")} · {c?.numberLabel}
                    {c?.sectorName ? ` · ${c.sectorName}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={c?.assignedUserId ?? ""}
                  onChange={(e) => void assignTo(e.target.value || null)}
                  disabled={c?.status === "CLOSED"}
                  className="hidden rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 focus:border-sky-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 sm:block"
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
                <button
                  type="button"
                  onClick={() => setDetailsOpen((o) => !o)}
                  title="Detalhes, setor e etiquetas"
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
                    detailsOpen
                      ? "border-sky-400 bg-sky-50 text-sky-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Detalhes
                  {(c?.contactTags?.length ?? 0) > 0 ? (
                    <span className="ml-1 rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-700">
                      {c?.contactTags?.length}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>

            {c?.status === "PENDING" && (
              <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
                <span>Conversa pendente — aguardando atendimento.</span>
                <button
                  type="button"
                  onClick={() => void act("take")}
                  className="font-semibold text-emerald-700 hover:underline"
                >
                  Assumir agora
                </button>
              </div>
            )}

            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              <div className="relative flex min-w-0 flex-1 flex-col">
                <div
                  ref={scrollRef}
                  onScroll={handleScroll}
                  className="min-w-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto bg-slate-50 p-5 chat-scroll"
                >
                  <MessageList
                    messages={selected.messages}
                    onReact={reactToMessage}
                    onOpenImage={setViewerSrc}
                    onDelete={deleteForAll}
                    onReply={startReply}
                  />
                  <div ref={bottomRef} />
                </div>
                {showScrollBottom && (
                  <button
                    type="button"
                    onClick={() => scrollToBottom(true)}
                    title="Ir para o fim da conversa"
                    className="absolute bottom-3 right-4 z-10 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-md hover:bg-slate-50"
                  >
                    ↓ Ir para o fim
                  </button>
                )}
              </div>

              {/* painel lateral retratil: detalhes, setor e etiquetas */}
              {detailsOpen && (
                <aside className="absolute inset-y-0 right-0 z-20 w-72 max-w-[85vw] shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50 p-4 space-y-4 shadow-lg md:static md:border-slate-100 md:bg-slate-50/60 md:shadow-none">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Contato
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-800">
                      {c?.contactName || c?.contactPhone}
                    </p>
                    <p className="text-xs text-slate-500">
                      {c?.contactIsGroup ? "Grupo" : formatPhone(c?.contactPhone ?? "")}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">Canal: {c?.numberLabel}</p>
                  </div>

                  <div className="border-t border-slate-200 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Atendimento
                    </p>
                    <div className="mt-2 space-y-2">
                      <div>
                        <label className="block text-xs text-slate-500">Atendente</label>
                        <select
                          value={c?.assignedUserId ?? ""}
                          onChange={(e) => void assignTo(e.target.value || null)}
                          disabled={c?.status === "CLOSED"}
                          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-sky-500 focus:outline-none disabled:bg-slate-100"
                        >
                          <option value="">Sem atendente</option>
                          {usersList.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {me?.role === "ADMIN" && (
                        <div>
                          <label className="block text-xs text-slate-500">Setor</label>
                          <select
                            value={c?.sectorId ?? ""}
                            onChange={(e) => void moveToSector(e.target.value || null)}
                            disabled={movingSector}
                            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-sky-500 focus:outline-none disabled:bg-slate-100"
                          >
                            <option value="">Sem setor (empresa)</option>
                            {sectorsList.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Etiquetas
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {(c?.contactTags ?? []).map((t) => (
                        <span
                          key={t.id}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
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
                            <IconX className="inline h-3 w-3" />
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
                            className="w-full rounded-md border border-sky-400 bg-white px-2 py-1 text-xs focus:outline-none"
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
                          className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-400 hover:border-sky-400 hover:text-sky-600"
                        >
                          ＋ etiqueta
                        </button>
                      )}
                    </div>
                  </div>
                </aside>
              )}
            </div>

            <div className="relative border-t border-slate-100 bg-white">
              {/* barra de resposta: citacao acima do composer (cancela com x) */}
              {replyTo && canSend ? (
                <div className="chat-quote mx-3 mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-sky-700">↩ {replyTo.name}</p>
                    <p className="truncate text-xs text-slate-600">{replyTo.snippet}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    title="Cancelar resposta"
                    className="ml-2 shrink-0 text-sm text-slate-500 hover:text-rose-600"
                  >
                    <IconX className="inline h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}

              {/* preview agrupado de arquivos antes do envio (estilo WhatsApp) */}
              {pendingFiles.length > 0 && canSend ? (
                <div className="mx-3 mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-600">
                      {pendingFiles.length}{" "}
                      {pendingFiles.length === 1 ? "arquivo selecionado" : "arquivos agrupados"}
                    </span>
                    <button
                      type="button"
                      onClick={clearPendingFiles}
                      className="text-xs text-slate-500 hover:text-rose-600"
                    >
                      Limpar tudo
                    </button>
                  </div>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {pendingFiles.map((item) => (
                      <div
                        key={item.id}
                        className="relative shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white"
                      >
                        {item.previewUrl ? (
                          <img
                            src={item.previewUrl}
                            alt={item.file.name}
                            className="h-16 w-16 object-cover"
                          />
                        ) : (
                          <div className="flex h-16 w-36 flex-col justify-center px-2.5">
                            <p className="truncate text-xs font-medium text-slate-700">
                              {item.file.name}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {(item.file.size / 1024).toFixed(0)} KB
                            </p>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removePendingFile(item.id)}
                          title="Remover arquivo"
                          className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white hover:bg-rose-600"
                        >
                          <IconX className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Adicionar mais arquivos"
                      className="flex h-16 w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 text-lg font-medium text-slate-400 hover:border-sky-400 hover:text-sky-600"
                    >
                      +
                    </button>
                  </div>
                </div>
              ) : null}

              {/* popover de respostas rapidas (via "/" ou botao de raio) */}
              {showReplies ? (
                <div className="absolute bottom-full left-3 right-3 z-20 mb-2 max-h-[40vh] max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {filteredQuickReplies.length === 0 ? (
                    <p className="p-3 text-xs text-slate-400">
                      {slashMatch
                        ? "Nenhuma resposta rápida encontrada."
                        : "Nenhuma resposta rápida disponível."}
                    </p>
                  ) : (
                    filteredQuickReplies.map((r, idx) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => applyQuickReply(r)}
                        onMouseEnter={() => setReplyIndex(idx)}
                        className={`block w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 ${
                          idx === Math.min(replyIndex, filteredQuickReplies.length - 1)
                            ? "bg-sky-50"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        <span className="font-mono text-xs font-semibold text-sky-700">
                          {r.shortcut}
                        </span>
                        <span className="ml-2 text-xs text-slate-400">{r.sectorName ?? "todos"}</span>
                        <p className="truncate text-xs text-slate-600">{r.content}</p>
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              <form onSubmit={send} className="flex items-end gap-2 p-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/*,video/*,audio/*,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx"
                  onChange={(e) => {
                    if (e.target.files?.length) stageFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canSend || uploading}
                  title="Anexar imagem, documento, áudio ou vídeo (até 25 MB)"
                  className="h-9 shrink-0 rounded-md border border-slate-300 px-3 text-base text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <IconPaperclip className="inline h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReplyIndex(0);
                    setRepliesOpen((o) => !o);
                  }}
                  disabled={!canSend}
                  title="Respostas rápidas (ou digite /)"
                  className={`h-9 shrink-0 rounded-md border px-3 text-base disabled:opacity-50 ${
                    showReplies
                      ? "border-sky-400 bg-sky-50 text-sky-700"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <IconBolt className="inline h-4 w-4" />
                </button>
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setReplyIndex(0);
                  }}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (showReplies && filteredQuickReplies.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setReplyIndex((i) => (i + 1) % filteredQuickReplies.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setReplyIndex((i) =>
                          (i - 1 + filteredQuickReplies.length) % filteredQuickReplies.length
                        );
                        return;
                      }
                      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                        e.preventDefault();
                        const chosen =
                          filteredQuickReplies[
                            Math.min(replyIndex, filteredQuickReplies.length - 1)
                          ];
                        if (chosen) applyQuickReply(chosen);
                        return;
                      }
                    }
                    if (e.key === "Escape") {
                      if (repliesOpen) {
                        e.preventDefault();
                        setRepliesOpen(false);
                        return;
                      }
                      if (replyTo) {
                        e.preventDefault();
                        setReplyTo(null);
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={
                    !canSend
                      ? "Conversa encerrada"
                      : pendingFiles.length > 0
                        ? "Adicione uma legenda (opcional) e pressione Enter..."
                        : "Escreva a mensagem (Shift+Enter quebra linha, / para rápidas)..."
                  }
                  disabled={!canSend || uploading}
                  className="max-h-[140px] min-h-[36px] flex-1 resize-none overflow-y-auto rounded-md border border-slate-300 px-3 py-2 text-sm leading-snug focus:border-sky-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                />
                <button
                  type="submit"
                  disabled={
                    !canSend ||
                    uploading ||
                    sending ||
                    (!draft.trim() && pendingFiles.length === 0)
                  }
                  className="h-9 shrink-0 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {uploading ? "Enviando..." : "Enviar"}
                </button>
              </form>
            </div>
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
        className="viewer-btn absolute right-4 top-4 flex h-10 w-10 items-center justify-center text-xl leading-none"
      >
        <IconX className="h-5 w-5" />
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
          <IconDownload className="h-5 w-5" />
        </a>
      </div>

      {/* dica de uso */}
      <p className="viewer-btn absolute bottom-5 left-4 hidden px-3 py-1.5 text-xs md:block">
        roda = zoom · arraste = mover · duplo clique = reset
      </p>
    </div>
  );
}





