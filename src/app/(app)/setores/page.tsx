import { requireSession } from "@/lib/auth";
import SetoresClient from "./setores-client";

export const dynamic = "force-dynamic";

export default async function SetoresPage() {
  await requireSession();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Setores</h1>
      <p className="mt-1 text-sm text-slate-500">
        Cadastre os setores que vao gerenciar seus próprios números e atendimentos.
      </p>
      <div className="mt-6">
        <SetoresClient />
      </div>
    </div>
  );
}
