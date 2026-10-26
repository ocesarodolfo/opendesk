"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Theme = "light" | "dark" | "system";
const THEME_OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Claro", icon: "☀️" },
  { value: "dark", label: "Escuro", icon: "🌙" },
  { value: "system", label: "Sistema", icon: "🖥️" },
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function UserMenu({ name, role }: { name: string; role: string }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
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
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-800"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
          {initials(name)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium text-white">{name}</span>
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
          className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-800 shadow-xl"
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
                    ? "bg-indigo-600/20 text-white"
                    : "text-slate-300 hover:bg-slate-700 hover:text-white"
                }`}
              >
                <span aria-hidden className="w-5 shrink-0 text-center border-none">{o.icon}</span>
                <span className="min-w-0 flex-1 truncate text-left">{o.label}</span>
                <span
                  aria-hidden
                  className={`shrink-0 text-xs ${theme === o.value ? "text-indigo-300" : "opacity-0"}`}
                >
                  ✓
                </span>
              </button>
            ))}
          </div>

          <div className="border-t border-slate-700 py-1">
            <Link
              href="/conta"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md mx-1 px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              <span aria-hidden className="w-5 shrink-0 text-center">👤</span>
              <span className="min-w-0 flex-1 truncate">Meu perfil</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
