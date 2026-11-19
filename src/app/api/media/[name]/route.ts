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

  const url = new URL(req.url);
  const isDownload = Boolean(url.searchParams.get("download"));
  const mime = mimeFor(name);
  const total = buffer.byteLength;
  const rangeHeader = req.headers.get("range");

  if (rangeHeader && !isDownload && total > 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }

    const [, startStr, endStr] = match;
    let start: number;
    let end: number;

    if (startStr === "" && endStr !== "") {
      const suffix = Number(endStr);
      if (!Number.isFinite(suffix) || suffix <= 0) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
      }
      start = Math.max(0, total - suffix);
      end = total - 1;
    } else if (startStr !== "") {
      start = Number(startStr);
      end = endStr ? Math.min(Number(endStr), total - 1) : total - 1;
    } else {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      start >= total ||
      start > end
    ) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }

    const chunk = buffer.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=86400",
      },
    });
  }

  const headers = new Headers({
    "Content-Type": mime,
    "Content-Length": String(total),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
  });
  if (isDownload) {
    headers.set("Content-Disposition", `attachment; filename="${name}"`);
  }
  return new NextResponse(new Uint8Array(buffer), { status: 200, headers });
}
