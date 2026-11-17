import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getVapidPublicKey } from "@/lib/push";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  return NextResponse.json({ publicKey: getVapidPublicKey() });
}

