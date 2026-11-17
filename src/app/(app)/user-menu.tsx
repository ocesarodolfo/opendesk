"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getMute,
  setMute,
  getSound,
  setSound,
  playSound,
  SOUND_OPTIONS,
  type SoundName,
} from "@/components/notif-sound";
import {
  IconSun,
  IconMoon,
  IconMonitor,
  IconBell,
  IconBellOff,
  IconUser,
  IconCheck,
} from "@/components/icons";
import PushToggle from "@/components/push-toggle";

type Theme = "light" | "dark" | "system";
import type { ReactNode } from "react";
const THEME_OPTIONS: { value: Theme; label: string; Icon: (p: { className?: string }) => ReactNode }[] = [
  { value: "light", label: "Claro", Icon: IconSun },
  { value: "dark", label: "Escuro", Icon: IconMoon },
  { value: "system", label: "Sistema", Icon: IconMonitor },
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function UserMenu({ name, role }: { name: string; role: string }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const [muted, setMutedLocal] = useState(false);
  const [sound, _setSound] = useState<SoundName>("classico");
  const boxRef = useRef<HTMLDivElement>(null);

  // fecha ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // tema: mesma chave de escolha do app (antes no ThemeToggle)
  useEffect(() => {
    setTheme((localStorage.getItem("atende_theme") as Theme) || "system");
    // notificação: espelha as preferencias do inbox (localStorage)
    setMutedLocal(getMute());
    _setSound(getSound());
  }, []);

  useEffect(() => {
    const apply = () => {
      const dark =
        theme === "dark" ||
        (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    if (theme === "system" && window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  function changeTheme(next: Theme) {
    setTheme(next);
    localStorage.setItem("atende_theme", next);
  }

  return (
    <div className="relative flex w-full items-center gap-2" ref={boxRef}>
      {/* botao do usuario: abre o dropdown */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
          {initials(name)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium text-slate-900">{name}</span>
          <span className="block truncate text-xs text-slate-500">
            {role === "ADMIN" ? "Administrador" : "Atendente"}
          </span>
        </span>
        {/* chevron: aponta para cima (menu abre acima) e gira ao abrir */}
        <svg
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M14.77 12.78a.75.75 0 0 1-1.06 0L10 9.06l-3.72 3.72a.75.75 0 1 1-1.06-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* dropdown (abre para cima; limitado a largura da sidebar) */}
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          {/* tema */}
          <p className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Tema
          </p>
          <div className="px-1 pb-2">
            {THEME_OPTIONS.map((o) => (
              <button
                key={o.value}
                role="menuitem"
                onClick={() => changeTheme(o.value)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                  theme === o.value
                    ? "bg-indigo-600/15 font-medium text-indigo-600"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span aria-hidden className="w-5 shrink-0 text-center border-none">
                  <o.Icon className="inline h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-left">{o.label}</span>
                <span
                  aria-hidden
                  className={`shrink-0 text-xs ${theme === o.value ? "text-indigo-500" : "opacity-0"}`}
                >
                  <IconCheck className="inline h-3.5 w-3.5" />
                </span>
              </button>
            ))}
          </div>

          <div className="border-t border-slate-200 px-1 py-2">
            <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Notificação
            </p>
            <button
              role="menuitem"
              onClick={() => {
                const next = !muted;
                setMutedLocal(next);
                setMute(next);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              title={muted ? "Ativar aviso sonoro" : "Silenciar aviso sonoro"}
            >
              <span aria-hidden className="w-5 shrink-0 text-center">
                {muted ? (
                  <IconBellOff className="inline h-4 w-4" />
                ) : (
                  <IconBell className="inline h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1 text-left">{muted ? "Silenciado" : "Som ativo"}</span>
            </button>
            {!muted ? (
              <div className="flex flex-wrap gap-1 px-2 pt-1">
                {SOUND_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    role="menuitem"
                    onClick={() => {
                      _setSound(o.value);
                      setSound(o.value); // persiste + pre-listen
                    }}
                    className={`rounded px-2 py-1 text-xs ${
                      sound === o.value
                        ? "bg-indigo-600/20 font-medium text-indigo-600"
                        : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : null}
            <PushToggle />
          </div>

          <div className="border-t border-slate-200 py-1">
            {role === "ADMIN" ? (
              <Link
                href="/usuarios"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-md mx-1 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              >
                <span aria-hidden className="w-5 shrink-0 text-center">
                  <IconUser className="inline h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">Gerenciar usuários</span>
              </Link>
            ) : null}
            <Link
              href="/conta"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md mx-1 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            >
              <span aria-hidden className="w-5 shrink-0 text-center">
                <IconUser className="inline h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate">Meu perfil</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
