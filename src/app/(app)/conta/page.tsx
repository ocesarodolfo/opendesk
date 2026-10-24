import { requireSession } from "@/lib/auth";
import ContaClient from "./conta-client";

export const dynamic = "force-dynamic";

export default async function ContaPage() {
  const session = await requireSession();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Minha conta</h1>
      <p className="mt-1 text-sm text-slate-500">
        Alteração da sua senha de acesso ({session.name}).
      </p>
      <div className="mt-6 max-w-sm">
        <ContaClient />
      </div>
    </div>
  );
}
