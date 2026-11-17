"use client";

import { useState, type ReactNode } from "react";
import SidebarNav, { type SidebarNavItem } from "./sidebar-nav";
import UserMenu from "./user-menu";
import LogoutButton from "./logout-button";
import { IconX } from "@/components/icons";

export default function AppShell({
  navItems,
  userName,
  userRole,
  children,
}: {
  navItems: SidebarNavItem[];
  userName: string;
  userRole: string;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const sidebarContent = (onNavigate?: () => void) => (
    <>
      <div className="flex items-center justify-between px-5 py-5">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Central de Atendimento
        </p>
        {onNavigate ? (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Fechar menu"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 md:hidden"
          >
            <IconX className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      <SidebarNav items={navItems} onNavigate={onNavigate} />
      <div className="border-t border-slate-200 px-4 py-4">
        <div className="flex items-center gap-2">
          <UserMenu name={userName} role={userRole} />
          <LogoutButton />
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Barra superior mobile */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menu"
          className="rounded-md p-1.5 text-slate-700 hover:bg-slate-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <p className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Central de Atendimento
        </p>
        <div className="w-8" aria-hidden />
      </header>

      {/* Drawer mobile */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <aside className="relative z-50 flex w-64 max-w-[80vw] flex-col border-r border-slate-200 bg-white text-slate-700 shadow-xl">
            {sidebarContent(() => setMenuOpen(false))}
          </aside>
        </div>
      )}

      {/* Sidebar fixa desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-white text-slate-700 md:flex">
        {sidebarContent()}
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6 md:ml-60 md:p-8">{children}</main>
    </div>
  );
}

