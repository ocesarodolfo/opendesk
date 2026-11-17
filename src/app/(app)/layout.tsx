import { requireSession } from "@/lib/auth";
import UserMenu from "./user-menu";
import LogoutButton from "./logout-button";
import SidebarNav from "./sidebar-nav";
import { ToastHost } from "@/components/toast";

const NAV = [
  { href: "/inbox", label: "Inbox", adminOnly: false },
  { href: "/dashboard", label: "Dashboard", adminOnly: false },
  { href: "/relatorios", label: "Relatórios", adminOnly: true },
  { href: "/numeros", label: "Números WhatsApp", adminOnly: false },
  { href: "/setores", label: "Setores", adminOnly: true },
  { href: "/respostas", label: "Respostas rápidas", adminOnly: true },
  { href: "/usuarios", label: "Usuários", adminOnly: true },
  { href: "/auditoria", label: "Auditoria", adminOnly: true },
];

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-slate-200 bg-white text-slate-700">
        <div className="px-5 py-5">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-900">
            Central de Atendimento
          </p>
        </div>
        <SidebarNav
          items={NAV.filter((item) => !item.adminOnly || session.role === "ADMIN").map(
            ({ href, label }) => ({ href, label })
          )}
        />
        <div className="border-t border-slate-200 px-4 py-4">
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
