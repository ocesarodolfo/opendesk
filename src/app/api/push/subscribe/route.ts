import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashEndpoint } from "@/lib/push";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh.trim() : "";
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth.trim() : "";

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Inscricao push invalida." }, { status: 400 });
  }

  const endpointHash = hashEndpoint(endpoint);
  await prisma.pushSubscription.upsert({
    where: { endpointHash },
    update: { userId: session.sub, endpoint, p256dh, auth },
    create: { userId: session.sub, endpointHash, endpoint, p256dh, auth },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) {
    return NextResponse.json({ error: "Informe o endpoint." }, { status: 400 });
  }

  const endpointHash = hashEndpoint(endpoint);
  await prisma.pushSubscription
    .deleteMany({ where: { endpointHash, userId: session.sub } })
    .catch(() => undefined);

  return NextResponse.json({ ok: true });
}

