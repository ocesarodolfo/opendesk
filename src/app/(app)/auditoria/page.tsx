import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import AuditoriaClient from "./auditoria-client";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage() {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    redirect("/inbox");
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Auditoria</h1>
      <p className="mt-1 text-sm text-slate-500">
        Registro completo de acessos, alterações e ações realizadas na central.
      </p>
      <div className="mt-6">
        <AuditoriaClient />
      </div>
    </div>
  );
}

