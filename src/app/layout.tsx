import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Central de Atendimento",
  description: "Atendimento multicanal via WhatsApp para setores internos e externos",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // aplica o tema ANTES da primeira pintura (evita flash claro/escuro);
  // preferencia em localStorage, fallback no do sistema
  const themeBootstrap =
    "try{var t=localStorage.getItem('atende_theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}";
  return (
    <html lang="pt-BR" className="h-full" suppressHydrationWarning>
      <body className="h-full bg-slate-100 font-sans text-slate-900 antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        {children}
      </body>
    </html>
  );
}
