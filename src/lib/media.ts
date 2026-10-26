import "server-only";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/** Pasta onde os arquivos de midia recebidos/enviados ficam gravados (driver local). */
export function mediaDir(): string {
  return path.resolve(process.cwd(), process.env.MEDIA_DIR ?? "./media");
}

// ---------------------------------------------------------------------------
// Drivers de armazenamento (docs/10-mysql-e-s3.md):
//   local (default, dev): DISCO em MEDIA_DIR
//   s3 (producao):       bucket privado; o app lê/escreve via API autenticada
//                        (/api/media/[name]) — o bucket NUNCA fica publico
// Envs: STORAGE_DRIVER=local|s3, S3_BUCKET, S3_REGION, S3_PREFIX,
//       S3_ENDPOINT (opcional: MinIO/Wasabi/LocalStack), S3_ACCESS_KEY_ID/SECRET
// ---------------------------------------------------------------------------
type StorageDriver = "local" | "s3";
export function storageDriver(): StorageDriver {
  return process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";
}
/** Chave do objeto no S3 ("media/msg-<uuid>.jpg") = prefixo + nome do arquivo. */
function s3Key(name: string): string {
  const prefix = (process.env.S3_PREFIX ?? "media").replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${name}` : name;
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

/** Grava a midia (disco local ou S3) e devolve o nome gerado (msg-<uuid>.ext). */
export async function saveMediaFile(buffer: Buffer, mime: string): Promise<string> {
  const name = `msg-${crypto.randomUUID()}.${extFor(mime)}`;
  if (storageDriver() === "s3") {
    const { putObject } = await s3Client();
    await putObject({
      Bucket: s3Bucket(),
      Key: s3Key(name),
      Body: buffer,
      ContentType: mime,
    });
  } else {
    await mkdir(mediaDir(), { recursive: true });
    await writeFile(path.join(mediaDir(), name), buffer);
  }
  return name;
}

export async function readMediaFile(name: string): Promise<Buffer | null> {
  try {
    if (storageDriver() === "s3") {
      const { getObject } = await s3Client();
      const res = await getObject({ Bucket: s3Bucket(), Key: s3Key(name) });
      return Buffer.from(await res.Body.transformToByteArray());
    }
    return await readFile(path.join(mediaDir(), name));
  } catch {
    return null;
  }
}

export async function deleteMediaFile(name: string): Promise<void> {
  if (storageDriver() === "s3") {
    const { deleteObject } = await s3Client();
    await deleteObject({ Bucket: s3Bucket(), Key: s3Key(name) }).catch(() => undefined);
    return;
  }
  const { rm } = await import("node:fs/promises");
  await rm(path.join(mediaDir(), name), { force: true }).catch(() => undefined);
}

// --- S3 (client lazy/shared) ---------------------------------------------
let s3Api: {
  putObject: (x: { Bucket: string; Key: string; Body: Buffer; ContentType: string }) => Promise<unknown>;
  getObject: (x: { Bucket: string; Key: string }) => Promise<{ Body: { transformToByteArray(): Promise<Uint8Array> } }>;
  deleteObject: (x: { Bucket: string; Key: string }) => Promise<unknown>;
} | null = null;

function s3Bucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("STORAGE_DRIVER=s3 mas S3_BUCKET nao configurado.");
  return bucket;
}

async function s3Client() {
  if (s3Api) return s3Api;
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } =
    await import("@aws-sdk/client-s3");
  const accessKey = process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  const client = new S3Client({
    region: process.env.S3_REGION,
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
    ...(accessKey && secretKey ? { credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } } : {}),
  });
  s3Api = {
    putObject: (x) => client.send(new PutObjectCommand(x)) as unknown as Promise<unknown>,
    getObject: (x) => client.send(new GetObjectCommand(x)) as unknown as Promise<{ Body: { transformToByteArray(): Promise<Uint8Array> } }>,
    deleteObject: (x) => client.send(new DeleteObjectCommand(x)) as unknown as Promise<unknown>,
  };
  return s3Api;
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
