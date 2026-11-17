import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import RespostasClient from "./respostas-client";

export const dynamic = "force-dynamic";

export default async function RespostasPage() {
  const session = await requireSession();
  if (session.role !== "ADMIN") redirect("/dashboard");

  return (
    <div>
      <h1 className="text-2xl font-semibold">Respostas rápidas</h1>
      <p className="mt-1 text-sm text-slate-500">
        Cadastre atalhos de mensagens para agilizar o atendimento no inbox.
      </p>
      <div className="mt-6">
        <RespostasClient />
      </div>
    </div>
  );
}
