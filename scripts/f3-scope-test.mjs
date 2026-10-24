// Smoke test do escopo por setor (F3) — usa apenas o cookie de quem logou por ultimo
import http from "node:http";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let cookie = "";
const call = (method, path, body) =>
  new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: "localhost", port: "3000", path, method,
        headers: {
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        const sc = res.headers["set-cookie"];
        if (sc) {
          const s = sc.find((c) => c.startsWith("atende_session="));
          if (s) cookie = s.split(";")[0];
        }
        res.setEncoding("utf8");
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => resolve({ status: res.statusCode, json: out }));
      }
    );
    if (data) r.write(data);
    r.end();
  });

const assert = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} | ${label}${detail ? ` | ${detail}` : ""}`);
  return cond;
};

const convId = process.argv[2];
if (!convId) {
  console.error("uso: node scripts/f3-scope-test.mjs <conversationId>");
  process.exit(1);
}

const stamp = Date.now();
let userIds = [];
let setorId = null;

try {
  // login admin
  const admin = await call("POST", "/api/auth/login", { email: "admin@empresa.local", password: "admin123" });
  assert("admin login", admin.status === 200, String(admin.status));

  // setor temporario + agente temporario (sem vinculo ainda)
  const setor = await call("POST", "/api/sectors", { name: `Setor-Teste-${stamp}` });
  setorId = JSON.parse(setor.json).id;
  assert("cria setor temp", setor.status === 201 || setor.status === 200, String(setor.status));

  const ag = await call("POST", "/api/users", {
    name: `Agente Teste ${stamp}`, email: `t${stamp}@temp.local`, password: "teste1234", role: "AGENT",
  });
  assert("cria agente temp", ag.status === 201, ag.json.slice(0, 80));
  userIds.push(JSON.parse(ag.json).id);

  // move conversa p/ setor de teste
  const mov = await call("PATCH", `/api/conversations/${convId}`, { sectorId: setorId });
  assert("admin move conversa p/ setor", mov.status === 200, String(mov.status));

  // agente SEM vinculo: lista sem a conversa + detalhe 403
  await call("POST", "/api/auth/login", { email: `t${stamp}@temp.local`, password: "teste1234" });
  const listOut = await call("GET", "/api/conversations?limit=100");
  const idsOut = JSON.parse(listOut.json).map((c) => c.id);
  assert("fora do setor: conversa ausente na lista", !idsOut.includes(convId), `len=${idsOut.length}`);
  const detOut = await call("GET", `/api/conversations/${convId}`);
  assert("fora do setor: detalhe 403", detOut.status === 403, String(detOut.status));

  // agente NAO move conversa de setor
  const movAg = await call("PATCH", `/api/conversations/${convId}`, { sectorId: null });
  assert("agente nao move setor (403)", movAg.status === 403, String(movAg.status));

  // vincula agente ao setor -> passa a ver
  await prisma.sectorMembership.create({ data: { userId: userIds[0], sectorId: setorId } });
  const listIn = await call("GET", "/api/conversations?limit=100");
  const idsIn = JSON.parse(listIn.json).map((c) => c.id);
  assert("no setor: conversa na lista", idsIn.includes(convId), `len=${idsIn.length}`);
  const detIn = await call("GET", `/api/conversations/${convId}`);
  assert("no setor: detalhe 200", detIn.status === 200, String(detIn.status));

  // admin ve tudo e restaura conversa (sem setor)
  await call("POST", "/api/auth/login", { email: "admin@empresa.local", password: "admin123" });
  const detAdm = await call("GET", `/api/conversations/${convId}`);
  assert("admin: detalhe 200", detAdm.status === 200, String(detAdm.status));
  const back = await call("PATCH", `/api/conversations/${convId}`, { sectorId: null });
  assert("admin restaura conversa (sem setor)", back.status === 200, String(back.status));
} finally {
  // limpeza (tolerante a falha parcial)
  await prisma.sectorMembership.deleteMany({ where: { userId: { in: userIds.filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds.filter(Boolean) } } });
  if (setorId) await prisma.sector.deleteMany({ where: { id: setorId } });
}

await prisma.$disconnect();
