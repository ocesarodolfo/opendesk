import { getSession } from "@/lib/auth";
import { getRealtimeBus, type RealtimeEvent } from "@/lib/realtime";
import { getSectorScope, type SectorScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

// eventos no escopo do usuario: ADMIN tudo; agente, seus setores + sem setor
function inScope(scope: SectorScope, event: RealtimeEvent): boolean {
  if (event.type !== "message:new" && event.type !== "conversation:update") return true;
  if (scope.kind === "ALL") return true;
  if (event.sectorId === undefined || event.sectorId === null) return true;
  return scope.sectorIds.includes(event.sectorId);
}

// Server-Sent Events: repassa os eventos do barramento para o browser.
// Eventos: connected (abertura), message:new, conversation:update, connection:update
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  // escopo resolvido uma vez por conexao; recarregar a pagina revalida
  const scope = await getSectorScope(session);

  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: RealtimeEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* cliente desconectou */
        }
      };

      const listener = (event: RealtimeEvent) => {
        if (inScope(scope, event)) send(event);
      };
      const bus = getRealtimeBus();
      bus.on("event", listener);

      const heartbeat = setInterval(() => {
        try {
          // comentario mantem a conexao viva sem gerar eventos 
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          /* ignora */
        }
      }, 25000);

      send({ type: "connected" });

      cleanup = () => {
        clearInterval(heartbeat);
        bus.off("event", listener);
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
