"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  IconComment,
  IconCheckCircle,
  IconWarnTriangle,
} from "@/components/icons";

/* =========================================================================
   ALERTAS FLUTUANTES (toasts) — substituem o alert() nativo.
   Uso: showToast("mensagem", "info" | "sucesso" | "erro") + <ToastHost />
   Nao precisa de Context: o evento flutua pela janela inteira.
   Cores controladas por classes usadas no globals.css (dark incluido).
   ========================================================================= */

type Toast = { id: number; text: string; kind: "info" | "sucesso" | "erro" };

const ICU: Record<
  Toast["kind"],
  { Icon: (p: { className?: string }) => ReactNode; box: string }
> = {
  info: { Icon: IconComment, box: "info" },
  sucesso: { Icon: IconCheckCircle, box: "sucesso" },
  erro: { Icon: IconWarnTriangle, box: "erro" },
};

/** Dispara um toast em qualquer lugar da janela (cliente). */
export function showToast(text: string, kind: Toast["kind"] = "info") {
  window.dispatchEvent(new CustomEvent("app:toast", { detail: { text, kind } }));
}

/** Pino no layout (uma vez por pagina) — escuta os eventos e renderiza a pilha. */
export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let seq = 0;
    const onToast = (e: Event) => {
      const { text, kind } = (e as CustomEvent).detail as { text: string; kind: Toast["kind"] };
      seq += 1;
      const id = seq;
      setToasts((prev) => [...prev.slice(-4), { id, text, kind }]);
      // purge automatico
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
    };
    window.addEventListener("app:toast", onToast);
    return () => window.removeEventListener("app:toast", onToast);
  }, []);

  return (
    <div className="toast-host pointer-events-none fixed bottom-6 right-6 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const I = ICU[t.kind].Icon;
        return (
          <div
            key={t.id}
            className={`toast-${ICU[t.kind].box} pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg transition-opacity ${
              ICU[t.kind].box
            }`}
          >
            <span className="shrink-0">
              <I className="h-4 w-4" />
            </span>
            <span className="break-words">{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
