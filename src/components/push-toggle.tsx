"use client";

import { useEffect, useState } from "react";
import { IconBell, IconBellOff } from "@/components/icons";

type PushState = "loading" | "unsupported" | "unconfigured" | "denied" | "enabled" | "disabled";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

export default function PushToggle() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function init() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (active) setState("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        if (active) setState("denied");
        return;
      }

      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          // garante que o servidor tem a inscricao atual
          void fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sub.toJSON()),
          });
          if (active) setState("enabled");
          return;
        }

        const keyRes = await fetch("/api/push/vapid-key");
        const keyData = keyRes.ok ? await keyRes.json().catch(() => null) : null;
        if (!keyData?.publicKey) {
          if (active) setState("unconfigured");
          return;
        }
        if (active) setState("disabled");
      } catch {
        if (active) setState("unsupported");
      }
    }
    void init();
    return () => {
      active = false;
    };
  }, []);

  async function toggle() {
    if (busy || state === "unsupported" || state === "unconfigured" || state === "denied" || state === "loading") {
      return;
    }
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (state === "enabled") {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch("/api/push/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        }
        setState("disabled");
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setState(perm === "denied" ? "denied" : "disabled");
          return;
        }
        const keyRes = await fetch("/api/push/vapid-key");
        const keyData = keyRes.ok ? await keyRes.json().catch(() => null) : null;
        if (!keyData?.publicKey) {
          setState("unconfigured");
          return;
        }
        const appServerKey = urlBase64ToUint8Array(keyData.publicKey);
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey.buffer as ArrayBuffer,
        });
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        if (res.ok) setState("enabled");
      }
    } finally {
      setBusy(false);
    }
  }

  if (state === "unsupported" || state === "unconfigured" || state === "loading") {
    return null;
  }

  const label =
    state === "enabled"
      ? "Push ativo (aba fechada)"
      : state === "denied"
        ? "Push bloqueado no navegador"
        : "Ativar push (aba fechada)";

  return (
    <button
      role="menuitem"
      disabled={busy || state === "denied"}
      onClick={() => void toggle()}
      className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60"
      title={
        state === "denied"
          ? "Libere as notificações nas configurações do navegador para este site"
          : "Receber notificações mesmo com a aba fechada"
      }
    >
      <span aria-hidden className="w-5 shrink-0 text-center">
        {state === "enabled" ? (
          <IconBell className="inline h-4 w-4 text-emerald-600" />
        ) : (
          <IconBellOff className="inline h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex-1 text-left">{busy ? "Salvando..." : label}</span>
    </button>
  );
}

