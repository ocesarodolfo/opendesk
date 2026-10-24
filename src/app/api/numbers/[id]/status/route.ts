import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth";
import { waManager } from "@/lib/whatsapp/manager";
import { prisma } from "@/lib/prisma";

// Status ao vivo do numero (e QR, quando em pareamento). Polling a cada ~2s.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  const live = waManager.getStatus(id);
  const record = await prisma.whatsAppNumber.findUnique({
    where: { id },
    select: { label: true, status: true, phone: true, lastError: true },
  });
  if (!record) return NextResponse.json({ error: "Numero inexistente." }, { status: 404 });

  // status "colado" no banco apos um restart: com sessao viva manda o live;
  // sem sessao viva, CONNECTED no banco e stale -> mostra DISCONNECTED
  const status =
    live.status !== "DISCONNECTED"
      ? live.status
      : record.status === "CONNECTED"
        ? "DISCONNECTED"
        : record.status;

  return NextResponse.json({
    status,
    phone: live.phone ?? record.phone,
    lastError: record.lastError,
    qrUrl: live.qr ? await QRCode.toDataURL(live.qr, { margin: 1 }) : null,
  });
}
