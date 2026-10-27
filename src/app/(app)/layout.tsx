import { requireSession } from "@/lib/auth";
import Link from "next/link";
import UserMenu from "./user-menu";
import LogoutButton from "./logout-button";
import InboxUnreadBadge from "@/components/inbox-unread-badge";
import { ToastHost } from "@/components/toast";

const NAV = [
  { href: "/inbox", label: "Inbox", adminOnly: false },
  { href: "/dashboard", label: "Dashboard", adminOnly: false },
  { href: "/relatorios", label: "Relatórios", adminOnly: true },
  { href: "/numeros", label: "Números WhatsApp", adminOnly: false },
  { href: "/setores", label: "Setores", adminOnly: true },
  { href: "/respostas", label: "Respostas rápidas", adminOnly: true },
  { href: "/usuarios", label: "Usuários", adminOnly: true },
];

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col bg-slate-900 text-slate-300">
        <div className="px-5 py-5">
          <p className="text-sm font-bold uppercase tracking-wide text-white">
            Central de Atendimento
          </p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.filter((item) => !item.adminOnly || session.role === "ADMIN").map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-slate-800 hover:text-white"
            >
              <span>{item.label}</span>
              {/* nao lidas: badge verde, como as bolhas do WhatsApp */}
              {item.href === "/inbox" ? <InboxUnreadBadge /> : null}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-4 py-4">
          <div className="flex items-center gap-2">
            <UserMenu name={session.name} role={session.role} />
            <LogoutButton />
          </div>
        </div>
      </aside>
      <main className="ml-60 flex-1 p-8">
        {children}
        <ToastHost />
      </main>
    </div>
  );
}
