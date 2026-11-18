import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";
import { auditLog, AUDIT_ACTIONS } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Rate limit simples do login (em memoria, por processo):
// max 8 tentativas por IP dentro de 15 min -> 429 por 15 min.
// Em producao com 1 processo Node bao para o Uso; se escalar horizontal
// trocar por Redis/limiter no proxy (ver docs/05-producao).
// ---------------------------------------------------------------------------
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 0, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function registerFailure(ip: string) {
  const entry = attempts.get(ip);
  if (entry) entry.count += 1;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    void auditLog({
      action: AUDIT_ACTIONS.LOGIN_FALHA,
      entity: "User",
      detail: "login bloqueado: rate limit estourado",
      req,
    });
    return NextResponse.json(
      {
        error: `Muitas tentativas de login. Tente novamente em ${Math.ceil(limit.retryAfterSec / 60)} minuto(s).`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    // Mensagem generica: nao revela se o e-mail existe
    if (!user || !user.active) {
      registerFailure(ip);
      void auditLog({
        action: AUDIT_ACTIONS.LOGIN_FALHA,
        entity: "User",
        detail: `credenciais invalidas: ${email}`,
        req,
      });
      return NextResponse.json({ error: "Credenciais invalidas." }, { status: 401 });
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      registerFailure(ip);
      void auditLog({
        action: AUDIT_ACTIONS.LOGIN_FALHA,
        entity: "User",
        entityId: user.id,
        detail: `senha incorreta: ${email}`,
        req,
      });
      return NextResponse.json({ error: "Credenciais invalidas." }, { status: 401 });
    }

    // login ok: limpa contador do IP
    attempts.delete(ip);

    void auditLog({
      action: AUDIT_ACTIONS.LOGIN,
      entity: "User",
      entityId: user.id,
      detail: `login OK: ${email} (${user.role})`,
      session: { sub: user.id, name: user.name, role: user.role === "ADMIN" ? "ADMIN" : "AGENT" },
      req,
    });

    await createSession({ sub: user.id, name: user.name, role: user.role === "ADMIN" ? "ADMIN" : "AGENT" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/login] erro ao autenticar:", err);
    return NextResponse.json(
      { error: "Erro interno ao autenticar. Verifique os logs do servidor." },
      { status: 500 }
    );
  }
}
