"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";
const OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Claro", icon: "☀️" },
  { value: "dark", label: "Escuro", icon: "🌙" },
  { value: "system", label: "Sistema", icon: "🖥️" },
];

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme((localStorage.getItem("atende_theme") as Theme) || "system");
  }, []);

  useEffect(() => {
    if (!document) return;
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

  function change(next: Theme) {
    setTheme(next);
    localStorage.setItem("atende_theme", next);
  }

  return (
    <div className="flex items-center gap-1 rounded-md bg-slate-800 p-1 text-xs">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => change(o.value)}
          title={`Tema ${o.label.toLowerCase()}`}
          className={`rounded px-2 py-1 ${
            theme === o.value ? "bg-slate-600 text-white" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
