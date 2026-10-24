import { redirect } from "next/navigation";

export default function Home() {
  // O middleware ja redireciona para /login quando nao ha sessao
  redirect("/dashboard");
}
