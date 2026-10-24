import "server-only";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/** Pasta onde os arquivos de midia recebidos/enviados ficam gravados. */
export function mediaDir(): string {
  return path.resolve(process.cwd(), process.env.MEDIA_DIR ?? "./media");
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export function extFor(mime: string): string {
  // remove parametros do mime ("audio/ogg; codecs=opus" -> "audio/ogg")
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  const known = EXT_BY_MIME[base];
  if (known) return known;
  const generic = base.split("/")[1];
  return generic?.replace(/[^a-z0-9]/gi, "") || "bin";
}

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime])
);
// nomes legados criados pelo bug do extFor ("audio/ogg; codecs=opus" virava
// ".oggcodecsopus") - arquivos de voz que já estao em disco continuam tocando
MIME_BY_EXT.oggcodecsopus = "audio/ogg";

export function mimeFor(name: string, fallback = "application/octet-stream"): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? fallback;
}

/** Grava a midia em disco e devolve o nome de arquivo gerado (msg-<uuid>.ext). */
export async function saveMediaFile(buffer: Buffer, mime: string): Promise<string> {
  await mkdir(mediaDir(), { recursive: true });
  const name = `msg-${crypto.randomUUID()}.${extFor(mime)}`;
  await writeFile(path.join(mediaDir(), name), buffer);
  return name;
}

export async function readMediaFile(name: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(mediaDir(), name));
  } catch {
    return null;
  }
}

export async function deleteMediaFile(name: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(path.join(mediaDir(), name), { force: true }).catch(() => undefined);
}

/**
 * Mime types aceitos no upload pelo painel. Imagem/video/audio liberados por
 * prefixo; documentos apenas em lista fechada (evita binarios arbitrarios).
 */
export const ALLOWED_UPLOAD_LIST = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export function isUploadAllowed(mime: string): boolean {
  return (
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/") ||
    ALLOWED_UPLOAD_LIST.has(mime)
  );
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
