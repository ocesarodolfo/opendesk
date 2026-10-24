import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { waManager } from "@/lib/whatsapp/manager";

// POST = iniciar conexao (solicita QR)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  const result = await waManager.connect(id).catch((error) => {
    console.error("[connect] falha:", error);
    return null;
  });
  if (!result) {
    return NextResponse.json({ error: "Falha ao iniciar a conexao. Verifique a internet/integração." }, { status: 500 });
  }
  return NextResponse.json(result);
}

// DELETE = desconectar (limpa a sessao, novo QR sera necessario)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  await waManager.logout(id);
  return NextResponse.json({ ok: true });
}
