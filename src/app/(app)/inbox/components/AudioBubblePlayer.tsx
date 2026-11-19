"use client";

import { useEffect, useRef, useState } from "react";

const SPEED_STEPS = [1, 1.25, 1.5, 2];
const SPEED_LABEL: Record<number, string> = {
  1: "1x",
  1.25: "1.25x",
  1.5: "1.5x",
  2: "2x",
};

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${sec}`;
}

/**
 * Player de audio para bolhas de mensagem (claro + escuro, recebida + enviada).
 * Suporta busca por arraste (HTTP Range), controle de velocidade e transcricao local via Web Worker.
 */
export function AudioBubblePlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  // Transcricao local em Web Worker (whisper-tiny)
  const workerRef = useRef<Worker | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [tState, setTState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setTranscript(null);
    setTState("idle");
  }, [src]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  function syncDuration(el: HTMLAudioElement) {
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) {
      setDuration(d);
      return;
    }
    if (el.seekable && el.seekable.length > 0) {
      const end = el.seekable.end(el.seekable.length - 1);
      if (Number.isFinite(end) && end > 0) {
        setDuration(end);
      }
    }
  }

  function transcribe() {
    if (transcript) {
      setTranscript(null);
      return;
    }
    setTState("loading");
    try {
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

  async function decodeAndSend(audioSrc: string) {
    try {
      const ab = await (await fetch(audioSrc)).arrayBuffer();
      const decoded = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(ab);
      const ch0 = decoded.getChannelData(0);
      let mono: Float32Array;
      if (decoded.numberOfChannels > 1) {
        const ch1 = decoded.getChannelData(1);
        mono = new Float32Array(ch0.length);
        for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
      } else {
        mono = new Float32Array(ch0);
      }
      workerRef.current!.postMessage({ audio: mono }, [mono.buffer]);
    } catch {
      setTState("error");
    }
  }

  const hasDuration = Number.isFinite(duration) && duration > 0;
  const progress = hasDuration ? Math.min(Math.max(time / duration, 0), 1) : 0;

  const timeLabel = hasDuration
    ? playing || time > 0
      ? `${fmtTime(time)} / ${fmtTime(duration)}`
      : fmtTime(duration)
    : playing || time > 0
      ? fmtTime(time)
      : "0:00";

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  function cycleSpeed() {
    const next = (speedIdx + 1) % SPEED_STEPS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEED_STEPS[next];
  }

  function seekToClientX(clientX: number) {
    const bar = barRef.current;
    const a = audioRef.current;
    if (!bar || !a || !hasDuration) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    a.currentTime = ratio * duration;
    setTime(a.currentTime);
  }

  return (
    <div className="flex w-[260px] max-w-full flex-col gap-2 sm:w-[296px]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          title={playing ? "Pausar" : "Reproduzir"}
          aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
          className="chat-audio-play flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm transition-colors hover:bg-emerald-700"
        >
          {playing ? (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <rect x="1.5" y="1" width="3" height="10" rx="1" />
              <rect x="7.5" y="1" width="3" height="10" rx="1" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <path d="M3 1.5c0-.8.9-1.3 1.6-.9l7 4.5c.6.4.6 1.4-.1 1.7l-7 4.5c-.7.4-1.5-.1-1.5-.9v-8.9z" />
            </svg>
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* barra de progresso (clique/arraste para pular) */}
          <div
            ref={barRef}
            role="slider"
            aria-label="Progresso do áudio"
            aria-valuemin={0}
            aria-valuemax={hasDuration ? Math.round(duration) : 0}
            aria-valuenow={Math.round(time)}
            className={`group/bar relative flex h-5 items-center ${
              hasDuration ? "cursor-pointer" : "cursor-default"
            }`}
            onPointerDown={(e) => {
              if (!hasDuration) return;
              const bar = barRef.current;
              if (!bar) return;
              seekToClientX(e.clientX);
              setScrubbing(true);
              bar.setPointerCapture(e.pointerId);
              const move = (ev: PointerEvent) => seekToClientX(ev.clientX);
              const up = () => {
                setScrubbing(false);
                bar.removeEventListener("pointermove", move);
                bar.removeEventListener("pointerup", up);
                bar.removeEventListener("pointercancel", up);
                if (bar.hasPointerCapture(e.pointerId)) {
                  bar.releasePointerCapture(e.pointerId);
                }
              };
              bar.addEventListener("pointermove", move);
              bar.addEventListener("pointerup", up);
              bar.addEventListener("pointercancel", up);
            }}
          >
            <div className="relative mx-1.5 h-1.5 w-full">
              <div className="chat-audio-track h-full w-full overflow-hidden rounded-full bg-slate-900/15">
                <div
                  className="chat-audio-fill h-full rounded-full bg-emerald-600"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              {hasDuration ? (
                <div
                  className={`chat-audio-thumb pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-700 shadow-sm transition-transform group-hover/bar:scale-110 ${
                    scrubbing ? "scale-110" : ""
                  }`}
                  style={{ left: `${progress * 100}%` }}
                />
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="chat-audio-time text-[11px] font-medium tabular-nums text-slate-600">
              {timeLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={cycleSpeed}
                title="Velocidade de reprodução"
                className={`chat-audio-btn rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  speedIdx > 0
                    ? "chat-audio-btn-active bg-sky-700 text-white"
                    : "bg-slate-900/10 text-slate-700 hover:bg-slate-900/15"
                }`}
              >
                {SPEED_LABEL[SPEED_STEPS[speedIdx]]}
              </button>
              <button
                type="button"
                onClick={transcribe}
                title={transcript ? "Ocultar transcrição" : "Transcrever áudio"}
                disabled={tState === "loading"}
                className={`chat-audio-btn rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  transcript
                    ? "chat-audio-btn-active bg-sky-700 text-white"
                    : "bg-slate-900/10 text-slate-700 hover:bg-slate-900/15"
                } ${tState === "loading" ? "animate-pulse" : ""}`}
              >
                {tState === "loading" ? "…" : "Aa"}
              </button>
            </div>
          </div>
        </div>

        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={(e) => {
            setPlaying(false);
            if (!hasDuration && e.currentTarget.currentTime > 0) {
              setDuration(e.currentTarget.currentTime);
            }
          }}
          onLoadedMetadata={(e) => syncDuration(e.currentTarget)}
          onDurationChange={(e) => syncDuration(e.currentTarget)}
          onCanPlay={(e) => syncDuration(e.currentTarget)}
          onTimeUpdate={(e) => {
            if (!hasDuration) syncDuration(e.currentTarget);
            if (!scrubbing) setTime(e.currentTarget.currentTime);
          }}
          onRateChange={(e) => {
            const i = SPEED_STEPS.indexOf(e.currentTarget.playbackRate);
            if (i >= 0) setSpeedIdx(i);
          }}
        />
      </div>

      {transcript ? (
        <p className="chat-audio-transcript border-t border-slate-900/10 pt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">
          {transcript}
        </p>
      ) : null}
      {tState === "error" ? (
        <p className="chat-audio-error text-[11px] font-medium text-rose-700">
          Não foi possível transcrever este áudio.
        </p>
      ) : null}
    </div>
  );
}
