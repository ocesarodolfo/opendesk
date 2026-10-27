"use client";

// Badge de nao lidas no item "Inbox" da sidebar: soma das mensagens recebidas
// ainda nao vistas por atendente (mesma metrica dos badges da lista). Poll
// leve + pausa quando a aba fica visivel/invisivel.
import { useEffect, useState } from "react";

export default function InboxUnreadBadge() {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/unread");
        if (res.ok && alive) {
          const data = (await res.json()) as { total: number };
          setTotal(data.total ?? 0);
        }
      } catch {
        /* offline: mantem o ultimo valor */
      }
    }
    void poll();
    const timer = setInterval(poll, 30000);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (total === 0) return null;
  return (
    <span
      title={`${total} mensagem(ns) nao lida(s)`}
      className="ml-1 inline-flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold leading-5 text-white"
    >
      {total > 99 ? "99+" : total}
    </span>
  );
}
