import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginForm from "./login-form";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Central de Atendimento</h1>
        <p className="mt-1 text-sm text-slate-500">
          Acesse para gerenciar os atendimentos do seu setor.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
