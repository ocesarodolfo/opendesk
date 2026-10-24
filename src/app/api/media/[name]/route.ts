import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { mimeFor, readMediaFile } from "@/lib/media";

// Serve arquivos de midia gravados em MEDIA_DIR (somente usuarios autenticados).
// GET /api/media/msg-<uuid>.jpg            -> inline (p/ <img>, <audio>, <video>)
// GET /api/media/msg-<uuid>.pdf?download=1 -> anexo
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { name } = await params;
  // protecao contra path traversal: apenas nomes "msg-<uuid>.<ext>"
  // (ext pode chegar a 16 chars pelos nomes legados ex. ".oggcodecsopus")
  if (!/^[A-Za-z0-9-]+\.[A-Za-z0-9]{1,16}$/.test(name)) {
    return new NextResponse("Invalid name", { status: 400 });
  }

  const buffer = await readMediaFile(name);
  if (!buffer) return new NextResponse("Not found", { status: 404 });

  const headers = new Headers({
    "Content-Type": mimeFor(name),
    "Content-Length": String(buffer.byteLength),
    "Cache-Control": "private, max-age=86400",
  });
  if (new URL(req.url).searchParams.get("download")) {
    headers.set("Content-Disposition", `attachment; filename="${name}"`);
  }
  return new NextResponse(new Uint8Array(buffer), { status: 200, headers });
}
