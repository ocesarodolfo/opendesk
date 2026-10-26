import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { waManager } from "@/lib/whatsapp/manager";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

// POST = iniciar conexao (solicita QR)
export async function POST(
  req: NextRequest,
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
  void auditLog({
    action: AUDIT_ACTIONS.NUMERO_CONEXAO,
    entity: "WhatsAppNumber",
    entityId: id,
    detail: "solicitado pareamento (QR)",
    session,
    req,
  });
  return NextResponse.json(result);
}

// DELETE = desconectar (limpa a sessao, novo QR sera necessario)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { id } = await params;
  await waManager.logout(id);
  void auditLog({
    action: AUDIT_ACTIONS.NUMERO_CONEXAO,
    entity: "WhatsAppNumber",
    entityId: id,
    detail: "desconectado (sessao apagada)",
    session,
    req,
  });
  return NextResponse.json({ ok: true });
}
