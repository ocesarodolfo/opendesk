import { requireSession } from "@/lib/auth";
import { ToastHost } from "@/components/toast";
import AppShell from "./app-shell";

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
  const navItems = NAV.filter((item) => !item.adminOnly || session.role === "ADMIN").map(
    ({ href, label }) => ({ href, label })
  );

  return (
    <AppShell navItems={navItems} userName={session.name} userRole={session.role}>
      {children}
      <ToastHost />
    </AppShell>
  );
}
