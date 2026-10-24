// Teste de renome de contato (PATCH /api/contacts/[id])
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

const conv = await p.conversation.findFirst({
  where: { contact: { isGroup: false } },
  select: { id: true, contactId: true, contact: { select: { pushName: true } } },
});
if (!conv) { console.log("sem conversa 1:1 para testar"); process.exit(0); }

await call("POST", "/api/auth/login", { email: "admin@empresa.local", password: "admin123" });

let r = await call("PATCH", `/api/contacts/${conv.contactId}`, { name: "Cliente Renomeado" });
console.log("rename:", r.status, r.json.slice(0, 80));

r = await call("GET", `/api/conversations/${conv.id}`);
console.log("detail contactoName:", JSON.parse(r.json).conversation.contactName);

// restaura (null = volta ao pushName)
r = await call("PATCH", `/api/contacts/${conv.contactId}`, { name: null });
console.log("restore:", r.status, r.json.slice(0, 80));

r = await call("GET", `/api/conversations/${conv.id}`);
console.log("detail contactoName final:", JSON.parse(r.json).conversation.contactName);

await p.$disconnect();
