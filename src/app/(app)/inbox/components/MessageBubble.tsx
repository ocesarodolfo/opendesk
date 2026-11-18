"use client";

import { useRef, useState } from "react";
import {
  IconBan,
  IconFile,
  IconTrash,
  IconPlus,
  IconClock,
  IconForward,
  IconSmile,
} from "@/components/icons";

/* =========================================================================
   TIPOS compartilhados da bolha de mensagem
   ========================================================================= */
export type MessageItem = {
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
  /** nome resolvido do autor da mensagem citada (grupo/participante/contato) */
  quotedSenderName?: string | null;
  reaction?: string | null;
  reactionMine?: boolean | null;
  /** envio otimista: bolha temporaria que ainda nao tinha confirmacao do servidor */
  pending?: boolean;
  /** mensagem revogada ("apagar para todos") */
  deleted?: boolean;
  /** mensagem encaminhada (etiqueta "Encaminhada" no topo da bolha) */
  forwarded?: boolean;
  /** id no lado do WhatsApp (necessario p/ apagar p/ todos) */
  externalId?: string | null;
  /** album de midia: imagens enviadas juntas compartilham esta chave */
  groupKey?: string | null;
};

/* =========================================================================
   TOKENS visuais — fonte unica de verdade da bolha (claro + escuro).
   As classes `chat-*` sao estilizadas em globals.css (html.dark .*).
   Mudou a cor mudou aqui — nao precisa caçar JSX espalhado.
   ========================================================================= */

// midia sem legenda = bolha com padding minimo (midia colada nos cantos)
const MEDIA_ONLY_CLASS = "overflow-hidden rounded-xl";
const TEXTUAL_CLASS = "rounded-xl px-3 py-2";

export const BUBBLE_OUT = "chat-bubble-out border-[#9fe6c8] bg-[#d9fdd3] text-slate-900";
export const BUBBLE_IN = "chat-bubble-in border-slate-300 bg-white text-slate-900";

// linha de informacao (hora + checks): tons distintos por lado p/ contraste
export const META_OUT = "text-slate-700";
export const META_IN = "text-slate-600";
export const META_FAILED = "font-semibold text-rose-600";

export const QUOTE_BOX = "chat-quote rounded-md border-l-4 border-sky-500 bg-slate-100 px-2 py-1";
// botao de velocidade (dark tem override em globals.css [.chat-audio-speed])
const SPEED_BTN =
  "chat-audio-speed shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-slate-900";

export const REACT_CHIP =
  "chat-react-chip flex items-center gap-0.5 rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-xs shadow-sm hover:bg-slate-50";
// seletor flutuante ACIMA da bolha (rapidos + expandir para mais emojis).
// ancora no lado oposto da borda livre: OUT alinhado a direita (bolha no fim),
// IN a esquerda — evita estourar a area do chat com bolhas curtas
export const REACT_STRIP_OUT = "absolute bottom-full right-1 z-30 mb-1";
export const REACT_STRIP_IN = "absolute bottom-full left-1 z-30 mb-1";
export const REACT_STRIP =
  "chat-react-strip flex items-center gap-0.5 rounded-full border border-slate-300 bg-white px-1.5 py-0.5 shadow-md";
// grade expandida (outros emojis) — popover logo abaixo do seletor,
// alinhada ao mesmo lado do ancora p/ nunca cortar a largura do container
export const REACT_EXTENDED_OUT = "absolute right-0 mt-1";
export const REACT_EXTENDED_IN = "absolute left-0 mt-1";
export const REACT_EXTENDED =
  "chat-react-extended z-30 grid w-72 grid-cols-8 gap-0.5 rounded-lg border border-slate-200 bg-white p-2 shadow-lg";

/* =========================================================================
   PLAYER DE AUDIO (estilo WhatsApp: pote translucido, botao redondo,
   barra arrastavel, tempo e velocidade)
   ========================================================================= */

const SPEED_STEPS = [1, 1.25, 1.5, 2];
const SPEED_LABEL: Record<number, string> = { 1: "1x", 1.25: "1.25x", 1.5: "1.5x", 2: "2x" };

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function AudioBubblePlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  // transcrição em WEB WORKER (whisper-tiny): a inferencia WASM roda fora da
  // thread principal — a tela NAO trava; modelo baixado pelo cliente no 1o uso
  const workerRef = useRef<Worker | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [tState, setTState] = useState<"idle" | "loading" | "error">("idle");

  function transcribe() {
    if (transcript) {
      setTranscript(null); // exibir/ocultar
      return;
    }
    setTState("loading");
    try {
      // worker reutilizado entre audios; cada novo envio substitui o anterior
      if (!workerRef.current) {
        workerRef.current = new Worker(
          new URL("./transcribe.worker.ts", import.meta.url)
        );
        workerRef.current.onmessage = (e: MessageEvent) => {
          const { ok, text } = (e.data ?? {}) as { ok?: boolean; text?: string };
          setTState(ok && text ? "idle" : "error");
          if (ok && text) setTranscript(text);
        };
        workerRef.current.onerror = () => setTState("error");
      }
      void decodeAndSend(src);
    } catch {
      setTState("error");
    }
  }

  // AudioContext nao existe em worker: decodifica aqui (thread principal,
  // rapido) e resamplea p/ 16 kHz mono via OfflineAudioContext
  async function decodeAndSend(src: string) {
    try {
      const ab = await (await fetch(src)).arrayBuffer();
      const decoded = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(ab);
      const ch0 = decoded.getChannelData(0);
      let mono: Float32Array;
      if (decoded.numberOfChannels > 1) {
        const ch1 = decoded.getChannelData(1);
        mono = new Float32Array(ch0.length);
        for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
      } else {
        mono = new Float32Array(ch0); // copia (transferownership no postMessage)
      }
      workerRef.current!.postMessage({ audio: mono }, [mono.buffer]);
    } catch {
      setTState("error"); // fis fail de decode (formato/codec/)
    }
  }

  const progress = duration > 0 ? Math.min(time / duration, 1) : 0;

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  function setSpeed(idx: number) {
    const next = (idx + 1) % SPEED_STEPS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEED_STEPS[next];
  }

  // pular na barra (clique ou arraste)
  function seek(e: React.PointerEvent<HTMLDivElement>) {
    const bar = barRef.current;
    const a = audioRef.current;
    if (!bar || !a || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    a.currentTime = ratio * duration;
    setTime(a.currentTime);
  }

  return (
    <div className="flex w-[260px] flex-col">
      <div className="chat-audio-player flex items-center gap-2 rounded-full bg-black/[0.05] px-2 py-1.5">
      <button
        type="button"
        onClick={toggle}
        title={playing ? "Pausar" : "Reproduzir"}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-white shadow-sm transition-colors hover:bg-green-700"
      >
        {playing ? (
          /* pausa: duas barras */
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <rect x="1.5" y="1" width="3" height="10" rx="1" />
            <rect x="7.5" y="1" width="3" height="10" rx="1" />
          </svg>
        ) : (
          /* play: triangulo */
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M3 1.5c0-.8.9-1.3 1.6-.9l7 4.5c.6.4.6 1.4-.1 1.7l-7 4.5c-.7.4-1.5-.1-1.5-.9v-8.9z" />
          </svg>
        )}
      </button>

      {/* barra de progresso (clique/arraste para pular) */}
      <div
        ref={barRef}
        className="group/bar relative h-4 flex-1 cursor-pointer"
        onPointerDown={(e) => {
          seek(e);
          setScrubbing(true);
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) => {
            const rect = barRef.current!.getBoundingClientRect();
            const ratio = Math.min(Math.max((ev.clientX - rect.left) / rect.width, 0), 1);
            if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
              audioRef.current.currentTime = ratio * audioRef.current.duration;
              setTime(audioRef.current.currentTime);
            }
          };
          const up = () => {
            setScrubbing(false);
            barRef.current?.removeEventListener("pointermove", move);
            barRef.current?.removeEventListener("pointerup", up);
            barRef.current?.releasePointerCapture?.(e.pointerId);
          };
          barRef.current?.addEventListener("pointermove", move);
          barRef.current?.addEventListener("pointerup", up);
        }}
      >
        <div className="chat-audio-track absolute top-1/2 h-1.5 w-full -translate-y-1/2 overflow-hidden rounded-full bg-slate-300/70">
          <div className="h-full rounded-full bg-green-600" style={{ width: `${progress * 100}%` }} />
        </div>
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-700 opacity-0 shadow transition-opacity group-hover/bar:opacity-100"
          style={{ left: `${progress * 100}%`, opacity: scrubbing ? 1 : undefined }}
        />
      </div>

      {/* tempo: atual / total */}
      <span className="shrink-0 text-[11px] tabular-nums text-slate-600">
        {fmtTime(duration > 0 ? time : 0)}/{duration > 0 ? fmtTime(duration) : "--:--"}
      </span>

      {/* velocidade: cicla 1x -> 1.25x -> 1.5x -> 2x */}
      <button
        type="button"
        onClick={() => setSpeed(speedIdx)}
        title="Velocidade de reprodução"
        className={SPEED_BTN}
      >
        {SPEED_LABEL[SPEED_STEPS[speedIdx]]}
      </button>

      {/* transcrever (Web Worker, local; NAO grava nada no banco) */}
      <button
        type="button"
        onClick={transcribe}
        title={transcript ? "Ocultar transcrição" : "Transcrever áudio"}
        disabled={tState === "loading"}
        className={`${SPEED_BTN} ${tState === "loading" ? "animate-pulse" : ""}`}
      >
        {tState === "loading" ? "…" : "Aa"}
      </button>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => {
          if (!scrubbing) setTime(e.currentTarget.currentTime);
        }}
        onRateChange={(e) => {
          const i = SPEED_STEPS.indexOf(e.currentTarget.playbackRate);
          if (i >= 0) setSpeedIdx(i);
        }}
      />
      </div>
      {/* texto do áudio (abaixo do player) */}
      {transcript ? (
        <p className="chat-audio-transcript whitespace-pre-wrap break-words rounded-lg px-1 pt-1 text-xs leading-snug">
          {transcript}
        </p>
      ) : null}
      {tState === "error" ? (
        <p className="px-1 pt-1 text-[11px] font-medium text-rose-600">
          Não foi possível transcrever este áudio.
        </p>
      ) : null}
    </div>
  );
}

/* =========================================================================
   BOLHA DE MENSAGEM (midia, texto, citacao, grupo, reacao, info + checks)
   ========================================================================= */

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🙏", "🔥", "🎉", "😢", "😮"];

// bancada completa para "reagir com outro emoji" (curada, sem categorias)
const MORE_EMOJIS = [
  "😀","😅","😂","🤣","😊","😍","🥰","😎",
  "🤔","😴","🤯","😭","😤","😡","🤝","🙌",
  "👏","👍","👎","💪","🌟","✨","⚡",
  "🔥","🎉","🎊","💯","❤️","🧡","💙","💜",
  "🥳","🤗","🤩","😚","😳","🥺","😉","🫶",
  "🤭","🫡","😱","😅","🤙","🤓","😇","🥹",
];

export function MessageBubble({
  message,
  onReact,
  onOpenImage,
  onDelete,
  onReply,
}: {
  message: MessageItem;
  onReact?: (message: MessageItem, emoji: string) => void;
  onOpenImage?: (src: string) => void;
  /** "apagar para todos" (so mensagens enviadas com id do WhatsApp) */
  onDelete?: (message: MessageItem) => void;
  /** preencher o composer em modo resposta */
  onReply?: (message: MessageItem) => void;
}) {
  const isOut = message.direction === "OUTGOING";
  const mediaOnly = !!message.mediaUrl && !message.content;
  const [moreOpen, setMoreOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reactHover, setReactHover] = useState(false);
  const reactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // reacoes: SO no hover do botao (com 500ms de graca p/ alcancar a faixa)
  function openReactNow() {
    if (reactTimer.current) clearTimeout(reactTimer.current);
    setReactHover(true);
  }
  function scheduleReactHide() {
    if (reactTimer.current) clearTimeout(reactTimer.current);
    reactTimer.current = setTimeout(() => setReactHover(false), 500);
  }
  const canDelete =
    !!onDelete && isOut && !message.pending && !!message.externalId && !message.deleted;

  let body: React.ReactNode = null;
  if (message.deleted) {
    // apagada para todos: exibicao unica estilo WhatsApp
    body = (
      <p className="flex items-center gap-1.5 text-sm italic text-slate-500">
        <IconBan className="h-4 w-4 shrink-0" /> Mensagem apagada para todos
      </p>
    );
  } else if (message.mediaUrl) {
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
      body = <AudioBubblePlayer src={src} />;
    } else {
      body = (
        <a
          href={`${src}?download=1`}
          className="flex items-center gap-2 font-medium text-sky-700 underline"
        >
          <IconFile className="h-4 w-4 shrink-0" />
          <span className="break-all">{message.fileName ?? "Arquivo anexado"}</span>
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
      <div className="relative min-w-[84px] max-w-[70%]">
        {/* menu de acoes: RESPONDER / APAGAR (abre no ⋯ do hover) */}
        {(onReply || canDelete) && !message.deleted ? (
          <div className={`${
            isOut ? ACTIONS_POS_OUT : ACTIONS_POS_IN
          } ${actionsOpen ? "" : "invisible opacity-0"}`}>
            <div className={ACTIONS_MENU}>
              {onReply ? (
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    onReply(message);
                  }}
                  className={ACTIONS_ITEM}
                >
                  ↩ Responder
                </button>
              ) : null}
              {canDelete ? (
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    onDelete?.(message);
                  }}
                  className={ACTIONS_ITEM_DANGER}
                >
                  <IconTrash className="h-3.5 w-3.5 shrink-0" /> Apagar para todos
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div
          className={`border text-sm shadow-sm ${mediaOnly ? MEDIA_ONLY_CLASS : TEXTUAL_CLASS} ${
            isOut ? BUBBLE_OUT : BUBBLE_IN
          }`}
        >
          {/* etiqueta de encaminhada — como o WhatsApp */}
          {message.forwarded ? (
            <p className="mb-0.5 flex items-center gap-1 text-xs italic text-slate-500">
              <IconForward className="h-3.5 w-3.5 shrink-0" /> Encaminhada
            </p>
          ) : null}
          {/* resposta citando outra mensagem ("responder" do WhatsApp) */}
          {message.quotedSnippet ? (
            <div className={`chat-quote mb-1 ${QUOTE_BOX} ${mediaOnly ? "mx-0.5 mt-0.5" : ""}`}>
              <p className="text-xs font-semibold text-sky-700">
                {message.quotedSenderName ||
                  (message.quotedSender?.length === 12 || message.quotedSender?.length === 13
                    ? formatPhone(message.quotedSender)
                    : null) ||
                  "Mensagem citada"}
              </p>
              <p className="whitespace-pre-wrap break-words text-xs font-medium text-slate-700">
                {message.quotedSnippet}
              </p>
            </div>
          ) : null}
          {/* grupo: nome do participante que enviou (nao aparece nas suas) */}
          {!isOut && message.senderName ? (
            <p className="mb-0.5 text-xs font-semibold text-sky-700">{message.senderName}</p>
          ) : null}
          {body}
          <p
            className={`flex items-center justify-end gap-1 text-right text-xs ${
              mediaOnly ? "mt-0.5 px-2 pb-0.5" : "mt-1"
            } ${
              message.status === "FAILED"
                ? META_FAILED
                : isOut
                  ? META_OUT
                  : META_IN
            }`}
          >
            {/* acoes: setinha estilo WhatsApp (aparece no hover do grupo) */}
            {(onReply || canDelete) && !message.deleted ? (
              <button
                onClick={() => setActionsOpen((o) => !o)}
                title="Ações"
                aria-haspopup="menu"
                className={`-mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/10 ${
                  actionsOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-slate-600">
                  <path d="M2.5 4.5 6 8l3.5-3.5" />
                </svg>
              </button>
            ) : null}
            {/* reacoes: botao dedicado — a faixa abre SO no hover dele */}
            {onReact && !message.deleted ? (
              <button
                onMouseEnter={openReactNow}
                onMouseLeave={scheduleReactHide}
                onClick={openReactNow}
                title="Reagir"
                aria-haspopup="menu"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/10 ${
                  reactHover ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                } ${message.reaction ? "mr-0.5" : ""}`}
              >
                <IconSmile className="h-3.5 w-3.5 text-slate-600" />
              </button>
            ) : null}
            {message.status === "FAILED" ? "falhou" : ""}
            {new Date(message.createdAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {/* checks do WhatsApp: ⏱ enviando, 1 visto = enviada,
                2 = entregue, 2 azuis = lida */}
            {isOut && message.status !== "FAILED" ? (
              message.pending ? (
                <span title="Enviando">
                  <IconClock className="inline h-3.5 w-3.5" />
                </span>
              ) : message.status === "READ" ? (
                <span className="font-bold text-sky-600" title="Lida">
                  ✓✓
                </span>
              ) : message.status === "DELIVERED" ? (
                <span className="font-bold" title="Entregue">
                  ✓✓
                </span>
              ) : (
                <span title="Enviada">✓</span>
              )
            ) : null}
          </p>
        </div>
        {/* reacao: EM FLUXO abaixo da bolha (nunca sobrepoe a hora/checks),
            recuada com margem negativa para encostar na bolha */}
        {message.reaction ? (
          <div className="-mt-1.5 ml-1 flex">
            <button
              onClick={() => onReact?.(message, message.reaction ?? "")}
              title="Reação — clique para remover"
              className={REACT_CHIP}
            >
              {message.reaction}
            </button>
          </div>
        ) : null}
        {/* seletor de reacoes: SO no hover proprio (botao emoji), com janela
            de graca p/ chegar a faixa; nada de "qualquer lugar da bolha" */}
        {onReact && !actionsOpen ? (
          <div
            onMouseEnter={openReactNow}
            onMouseLeave={scheduleReactHide}
            className={`${
              isOut ? REACT_STRIP_OUT : REACT_STRIP_IN
            } ${reactHover ? "opacity-100" : "pointer-events-none opacity-0"} transition-opacity`}
          >
            <div className={REACT_STRIP}>
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => onReact(message, e)}
                  className="px-0.5 text-sm transition-transform hover:scale-125"
                  title={`Reagir ${e}`}
                >
                  {e}
                </button>
              ))}
              {/* abre a bancada com outros emojis */}
              <button
                onClick={() => setMoreOpen((o) => !o)}
                title="Reagir com outro emoji"
                className={`px-0.5 text-xs font-bold transition-transform hover:scale-110 ${
                  moreOpen ? "text-sky-600" : "text-slate-500"
                }`}
              >
                <IconPlus className="mx-auto h-3.5 w-3.5" />
              </button>
            </div>
            {moreOpen ? (
              <div className={`${REACT_EXTENDED} ${isOut ? REACT_EXTENDED_OUT : REACT_EXTENDED_IN}`}>
                {MORE_EMOJIS.map((e, i) => (
                  <button
                    key={`${e}-${i}`}
                    onClick={() => {
                      onReact(message, e);
                      setMoreOpen(false);
                    }}
                    className="rounded p-0.5 text-base transition-transform hover:scale-125 hover:bg-slate-200"
                    title={`Reagir ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// menu de acoes (RESPONDER / APAGAR):
// - ancorado no lado da conversa (cada lado abre para DENTRO do painel,
//   nunca estourando a lateral esquerda/direita do scroll container)
export const ACTIONS_POS_OUT = "absolute bottom-full right-1 z-40 mb-1";
export const ACTIONS_POS_IN = "absolute bottom-full left-1 z-40 mb-1";
// o menu tem classes proprias p/ dark (chat-actions-* no globals.css)
export const ACTIONS_MENU =
  "chat-actions-menu flex w-44 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white p-1 shadow-lg";
export const ACTIONS_ITEM =
  "chat-actions-item flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100";
export const ACTIONS_ITEM_DANGER =
  "chat-actions-item chat-actions-item-danger flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-medium text-rose-600 hover:bg-rose-50";

function formatPhone(d: string): string {
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d}`;
}

/* =========================================================================
   ALBUM DE MIDIA: imagens enviadas juntas (mesmo groupKey) viram UMA bolha
   com grade de miniaturas — como a visualizacao de album do WhatsApp.
   Obs: no lado do WhatsApp as imagens saem como mensagens em sequencia
   (Baileys 6.x nao envia album de verdade); o painel junta a exibicao.
   ========================================================================= */

const RANK: Record<string, number> = { SENT: 0, DELIVERED: 1, READ: 2, FAILED: 0 };

function AlbumBubble({
  items,
  onOpenImage,
  onDelete,
  onReply,
}: {
  items: MessageItem[];
  onOpenImage?: (src: string) => void;
  onDelete?: (message: MessageItem) => void;
  onReply?: (message: MessageItem) => void;
}) {
  const [menuIdx, setMenuIdx] = useState<number | null>(null);
  const first = items[0];
  const isOut = first.direction === "OUTGOING";
  const caption = items.find((m) => m.content)?.content ?? "";
  const allDeleted = items.every((m) => m.deleted);
  const pending = items.some((m) => m.pending);
  const failed = items.some((m) => m.status === "FAILED");
  const minStatus = items.reduce(
    (acc, m) => Math.min(acc, RANK[m.status] ?? 0),
    Number.POSITIVE_INFINITY
  );
  const status =
    failed && !pending ? "FAILED" : ["SENT", "DELIVERED", "READ"][minStatus] ?? "SENT";

  return (
    <div className={`group mb-1.5 flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div className="relative min-w-[84px] max-w-[70%]">
        <div className={`border text-sm shadow-sm overflow-hidden rounded-xl ${isOut ? BUBBLE_OUT : BUBBLE_IN}`}>
          {allDeleted ? (
            <p className="flex items-center gap-1.5 px-3 py-2 text-sm italic text-slate-500">
              <IconBan className="h-4 w-4 shrink-0" /> Mensagem apagada para todos
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-0.5">
              {items.map((m, i) => {
                const src = m.mediaUrl ? `/api/media/${m.mediaUrl}` : null;
                const isImg = (m.mediaType ?? "").startsWith("image/");
                if (!isImg || m.deleted || !src) {
                  return (
                    <div key={m.id} className="flex min-h-[92px] items-center justify-center bg-black/5 p-2">
                      {m.deleted ? (
                        <span className="text-xs italic text-slate-500">apagada</span>
                      ) : isImg && !src ? (
                        <span className="inline-flex items-center text-xs text-slate-500" title="Enviando">
                          <IconClock className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span className="break-all text-xs text-slate-600">{m.fileName ?? "arquivo"}</span>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={m.id} className="relative">
                    <img
                      src={src}
                      alt={m.fileName ?? "imagem"}
                      loading="lazy"
                      onClick={() => onOpenImage?.(src)}
                      className="min-h-[92px] w-full cursor-zoom-in object-cover hover:opacity-90"
                    />
                    {/* acoes do item do album no hover do thumb */}
                    {onReply || onDelete ? (
                      <button
                        onClick={() => setMenuIdx(menuIdx === i ? null : i)}
                        title="Ações"
                        className={`absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/85 shadow transition-opacity hover:bg-slate-100 group-hover:opacity-100 ${
                          menuIdx === i ? "opacity-100" : "opacity-0"
                        }`}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-slate-600">
                          <path d="M2.5 4.5 6 8l3.5-3.5" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {caption && !allDeleted ? (
            <p className="whitespace-pre-wrap break-words px-3 py-2">{caption}</p>
          ) : null}
          <p className={`flex items-center justify-end gap-1 px-3 pb-2 text-right text-xs ${failed && !pending ? META_FAILED : isOut ? META_OUT : META_IN}`}>
            {failed && !pending ? "falhou" : ""}
            {new Date(first.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            {isOut && !failed ? (
              pending ? (
                <span title="Enviando">
                  <IconClock className="inline h-3.5 w-3.5" />
                </span>
              ) : status === "READ" ? (
                <span className="font-bold text-sky-600" title="Lida">✓✓</span>
              ) : status === "DELIVERED" ? (
                <span className="font-bold" title="Entregue">✓✓</span>
              ) : (
                <span title="Enviada">✓</span>
              )
            ) : null}
          </p>
        </div>
        {/* menu do item selecionado do album: ancorado ao ALBUM (não ao thumb,
            que é pequeno e faria o popover sangrar pra fora da grade) */}
        {menuIdx !== null && items[menuIdx] ? (() => {
          const mi = items[menuIdx];
          return (
            <div className={isOut ? ACTIONS_POS_OUT : ACTIONS_POS_IN}>
              <div className={ACTIONS_MENU}>
                {onReply ? (
                  <button
                    onClick={() => {
                      setMenuIdx(null);
                      onReply(mi);
                    }}
                    className={ACTIONS_ITEM}
                  >
                    ↩ Responder
                  </button>
                ) : null}
                {onDelete && isOut && !mi.pending && mi.externalId && !mi.deleted ? (
                  <button
                    onClick={() => {
                      setMenuIdx(null);
                      onDelete(mi);
                    }}
                    className={ACTIONS_ITEM_DANGER}
                  >
                    <IconTrash className="h-3.5 w-3.5 shrink-0" /> Apagar para todos
                  </button>
                ) : null}
              </div>
            </div>
          );
        })() : null}
      </div>
    </div>
  );
}

/* =========================================================================
   SEPARADOR DE DIA (estilo WhatsApp: Hoje / Ontem / dia da semana / data)
   ========================================================================= */
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays > 1 && diffDays < 7) {
    const weekday = d.toLocaleDateString("pt-BR", { weekday: "long" });
    return weekday.charAt(0).toUpperCase() + weekday.slice(1);
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

/* =========================================================================
   LISTA DE MENSAGENS: agrupa em sequencia as mensagens com mesmo groupKey
   e delega cada bloco a MessageBubble ou AlbumBubble
   ========================================================================= */
export function MessageList({
  messages,
  onReact,
  onOpenImage,
  onDelete,
  onReply,
}: {
  messages: MessageItem[];
  onReact?: (message: MessageItem, emoji: string) => void;
  onOpenImage?: (src: string) => void;
  onDelete?: (message: MessageItem) => void;
  onReply?: (message: MessageItem) => void;
}) {
  const blocks: MessageItem[][] = [];
  let current: MessageItem[] = [];
  let runningKey: string | null = null;

  for (const m of messages) {
    const hasMedia = !!m.mediaUrl && (m.mediaType ?? "").startsWith("image/");
    const groups = hasMedia && !m.pending && !!m.groupKey ? m.groupKey : null;
    if (groups && (current.length === 0 || runningKey === groups)) {
      current.push(m);
      runningKey = groups;
    } else {
      if (current.length) blocks.push(current);
      current = [m];
      runningKey = groups;
    }
  }
  if (current.length) blocks.push(current);

  let lastDay = "";

  return (
    <>
      {blocks.map((b) => {
        const currentDay = dayKey(b[0].createdAt);
        const showDateDivider = currentDay !== "" && currentDay !== lastDay;
        if (currentDay) lastDay = currentDay;

        const bubble =
          b.length > 1 ? (
            <AlbumBubble items={b} onOpenImage={onOpenImage} onDelete={onDelete} onReply={onReply} />
          ) : (
            <MessageBubble
              message={b[0]}
              onReact={onReact}
              onOpenImage={onOpenImage}
              onDelete={onDelete}
              onReply={onReply}
            />
          );

        return (
          <div key={b.length > 1 ? `album-${b[0].id}` : b[0].id} className="space-y-2">
            {showDateDivider && (
              <div className="my-3 flex justify-center">
                <span className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
                  {formatDayLabel(b[0].createdAt)}
                </span>
              </div>
            )}
            {bubble}
          </div>
        );
      })}
    </>
  );
}
