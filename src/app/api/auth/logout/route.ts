import { NextRequest, NextResponse } from "next/server";
import { clearSession, getSession } from "@/lib/auth";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (session) {
    void auditLog({
      action: AUDIT_ACTIONS.LOGOUT,
      entity: "User",
      entityId: session.sub,
      detail: session.name,
      session,
      req,
    });
  }
  await clearSession();
  return NextResponse.json({ ok: true });
}
