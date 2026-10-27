"use client";

// ---------------------------------------------------------------------------
// Web Worker da transcricao de audio (whisper-tiny, WASM): a inferencia roda
// AQUI (fora da thread principal) para NAO travar a tela do painel.
// AudioContext NAO existe em worker: o PCM 16kHz chega PRONTO do caller
// (decodeAudioData + resample ficam na thread principal).
// Modelo baixado pelo cliente no 1o uso (cache do browser); nada vai pro banco.
// ---------------------------------------------------------------------------
import { pipeline, env } from "@xenova/transformers";

// SEM tentativa local (evita 404 "/models/..." no servidor Next): modelo e
// pesos vem da Hugging Face; binarios de WASM do CDN oficial da lib
env.allowLocalModels = false;
env.remoteHost = "https://huggingface.co/";
env.backends.onnx.wasm.wasmPaths =
  "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/";

type AsrOut = { text?: string } | { text?: string }[];

// self sem tipagem DOM/Worker morta (lib do worker nao configurada no tsconfig)
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (m: unknown) => void;
};

let asr: ((audio: Float32Array, opts?: Record<string, unknown>) => Promise<AsrOut>) | null = null;
let loading: Promise<unknown> | null = null;

async function getAsr() {
  if (!asr) {
    if (!loading) {
      loading = pipeline("automatic-speech-recognition", "Xenova/whisper-tiny");
      asr = (await loading) as unknown as NonNullable<typeof asr>;
    } else {
      await loading;
    }
  }
  return asr as NonNullable<typeof asr>;
}

ctx.onmessage = async (e: MessageEvent) => {
  const { audio } = (e.data ?? {}) as { audio?: Float32Array };
  if (!audio) return;
  try {
    const p = await getAsr();
    const out = (await p(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      language: "portuguese",
      task: "transcribe",
    })) as AsrOut;
    const first = (Array.isArray(out) ? out[0] : out) as { text?: string };
    ctx.postMessage({ ok: true, text: (first.text ?? "").trim() });
  } catch (err) {
    ctx.postMessage({ ok: false, error: String(err) });
  }
};
