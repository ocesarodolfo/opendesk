import "server-only";
import { EventEmitter } from "node:events";

// Barramento de eventos em processos Node na mesma instancia do Next.js.
// Separa producao de dev (hot-reload) usando globalThis.
const globalForBus = globalThis as unknown as { __atendimento_bus?: EventEmitter };

export type RealtimeEvent =
  | { type: "connected" }
  | { type: "message:new"; conversationId: string; sectorId?: string | null; message: unknown }
  | { type: "message:update"; conversationId: string; sectorId?: string | null; message: unknown }
  | { type: "conversation:read"; conversationId: string; sectorId?: string | null; message: unknown }
  | { type: "conversation:update"; conversationId: string; sectorId?: string | null; status?: string }
  | { type: "connection:update"; numberId: string; status: string };

export function getRealtimeBus(): EventEmitter {
  const bus = globalForBus.__atendimento_bus ?? new EventEmitter();
  bus.setMaxListeners(0);
  globalForBus.__atendimento_bus = bus;
  return bus;
}

export function emitRealtime(event: RealtimeEvent): void {
  getRealtimeBus().emit("event", event);
}
