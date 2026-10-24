import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSupervisorSectorIds } from "@/lib/scope";

// dados da sessao atual (p.ex. a UI decide se mostra controles de ADMIN /
// modo de atribuicao em lote de supervisor)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  const supervisorSectorIds = await getSupervisorSectorIds(session);
  return NextResponse.json({
    id: session.sub,
    name: session.name,
    role: session.role,
    // ADMIN supervisiona tudo por papel (queima listando setores)
    supervisorSectorIds: session.role === "ADMIN" ? ["*"] : supervisorSectorIds,
  });
}
