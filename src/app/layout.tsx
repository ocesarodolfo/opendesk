import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Central de Atendimento",
  description: "Atendimento multicanal via WhatsApp para setores internos e externos",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="h-full bg-slate-100 font-sans text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
