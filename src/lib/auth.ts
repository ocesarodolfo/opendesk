import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "atende_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

export type SessionPayload = {
  sub: string; // userId
  name: string;
  role: "ADMIN" | "AGENT";
};

function getSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET ?? "";
  if (raw.length < 32 && process.env.NODE_ENV !== "development") {
    throw new Error("JWT_SECRET precisa ter ao menos 32 caracteres (ver .env)");
  }
  return new TextEncoder().encode(raw || "dev-secret-insecure-change-me-please-32c");
}

// ------------------------------------------------------------------ senha
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ------------------------------------------------------------------ jwt
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ name: payload.name, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

// Cookie JWT resulta em problema de type import: usamos namespace explicito
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      name: String(payload.name ?? ""),
      role: payload.role === "ADMIN" ? "ADMIN" : "AGENT",
    };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

// Uso em Server Components: redireciona se nao autenticado
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
