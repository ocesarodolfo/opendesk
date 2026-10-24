import { requireSession } from "@/lib/auth";
import UsuariosClient from "./usuarios-client";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  await requireSession();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Usuários</h1>
      <p className="mt-1 text-sm text-slate-500">
        Gerencie os colaboradores que acessam a central de atendimento.
      </p>
      <div className="mt-6">
        <UsuariosClient />
      </div>
    </div>
  );
}
