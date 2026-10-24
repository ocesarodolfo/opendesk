// Smoke test do SUPERVISOR por setor (F3-1)
// supervisor: atribuicao em lote no setor; agente comum: 403 no lote
import http from "node:http";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
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

const say = (ok, label, detail = "") =>
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${detail ? " | " + detail : ""}`);

// conversa de grupo real (fora do setor) que sera movida para o setor de teste
const convId = process.argv[2] ?? "f923e943-df88-4791-b25e-ef0a331c8d79";
const convNeutralId = process.argv[3] ?? "f68e72c0-5f56-421e-a95f-a0fb114d027e";

const stamp = Date.now();
let userIds = [];
let sectorId = null;
try {
  const l = await call("POST", "/api/auth/login", { email: "admin@empresa.local", password: "admin123" });
  say(l.status === 200, "admin login", String(l.status));

  const s = await call("POST", "/api/sectors", { name: `Setor-Sup-${stamp}` });
  sectorId = JSON.parse(s.json).id;
  say(s.status === 201 || s.status === 200, "cria setor", String(s.status));

  // supervisor e agente comum (via membershipRoles)
  const sup = await call("POST", "/api/users", {
    name: `Sup ${stamp}`, email: `sup${stamp}@temp.local`, password: "teste1234", role: "AGENT",
  });
  const supId = JSON.parse(sup.json).id;
  userIds.push(supId);
  let r = await call("PATCH", `/api/users/${supId}`, { membershipRoles: [{ sectorId, role: "SUPERVISOR" }] });
  say(r.status === 200, "cria SUPERVISOR vinc. ao setor", r.json.slice(0, 70));

  const ag1 = await call("POST", "/api/users", {
    name: `Ag1 ${stamp}`, email: `ag1${stamp}@temp.local`, password: "teste1234", role: "AGENT",
  });
  const ag1Id = JSON.parse(ag1.json).id;
  userIds.push(ag1Id);
  r = await call("PATCH", `/api/users/${ag1Id}`, { sectorIds: [sectorId] });
  say(r.status === 200, "cria agente comum (setor)", String(r.status));

  // conversa alvo entra no setor
  r = await call("PATCH", `/api/conversations/${convId}`, { sectorId });
  say(r.status === 200, "admin move conversa p/ setor", String(r.status));

  // supervisor: /api/me revela setores supervisionados
  await call("POST", "/api/auth/login", { email: `sup${stamp}@temp.local`, password: "teste1234" });
  r = await call("GET", "/api/me");
  const me = JSON.parse(r.json);
  say(me.supervisorSectorIds?.includes(sectorId) === true, "me: supervisorSectorIds", r.json.slice(0, 90));

  // atribuicao em lote pelo supervisor -> deve passar
  r = await call("PATCH", "/api/conversations/bulk", { conversationIds: [convId], assignedUserId: ag1Id });
  const bulk = JSON.parse(r.json);
  say(r.status === 200 && bulk.updated === 1, "supervisor: lote no proprio setor", `${r.status} updated=${bulk.updated}`);

  // conversa FORA dos setores supervisionados (sem setor = empresa -> ADMIN)
  r = await call("PATCH", "/api/conversations/bulk", { conversationIds: [convNeutralId], assignedUserId: ag1Id });
  say(r.status === 403, "supervisor: lote fora do setor (403)", String(r.status));

  // agente comum: 403 no lote
  await call("POST", "/api/auth/login", { email: `ag1${stamp}@temp.local`, password: "teste1234" });
  r = await call("PATCH", "/api/conversations/bulk", { conversationIds: [convId], assignedUserId: supId });
  say(r.status === 403, "agente comum: lote (403)", String(r.status));

  // admin: lote sem restricao
  await call("POST", "/api/auth/login", { email: "admin@empresa.local", password: "admin123" });
  r = await call("PATCH", "/api/conversations/bulk", { conversationIds: [convId, convNeutralId], assignedUserId: null });
  say(r.status === 200 && JSON.parse(r.json).updated === 2, "admin: lote tudo", `${r.status} updated=${JSON.parse(r.json).updated}`);

  // restaura conversa
  r = await call("PATCH", `/api/conversations/${convId}`, { sectorId: null });
  say(r.status === 200, "restaura conversa (sem setor)", String(r.status));

  say(true, "OK");
} finally {
  await p.sectorMembership.deleteMany({ where: { userId: { in: userIds.filter(Boolean) } } });
  await p.user.deleteMany({ where: { id: { in: userIds.filter(Boolean) } } });
  if (sectorId) await p.sector.deleteMany({ where: { id: sectorId } });
}
await p.$disconnect();
