// Smoke test: Respostas rapidas (CRUD ADMIN + lista para atendente)
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

const stamp = Date.now();
let replyId = null;
try {
  let r = await call("POST", "/api/auth/login", { email: "admin@empresa.local", password: "admin123" });
  say(r.status === 200, "admin login");

  // cria resposta global
  r = await call("POST", "/api/quick-replies", {
    shortcut: `tchau-${stamp}`, content: "Obrigado pelo contato! Qualquer coisa, so chamar.",
  });
  say(r.status === 201, "POST cria", String(r.status));
  replyId = JSON.parse(r.json).id;

  // lista inclui a resposta
  r = await call("GET", "/api/quick-replies");
  say(JSON.parse(r.json).some((q) => q.id === replyId), "GET lista com resposta");

  // patch de conteudo
  r = await call("PATCH", `/api/quick-replies/${replyId}`, { content: "Texto atualizado!" });
  say(r.status === 200 && JSON.parse(r.json).content === "Texto atualizado!", "PATCH atualiza");

  // vazio -> 400
  r = await call("PATCH", `/api/quick-replies/${replyId}`, { content: "" });
  say(r.status === 400, "PATCH vazio (400)", String(r.status));

  // atendente comum nao cria/apaga (cria usuario temp pelo banco)
  const uid = (await p.user.create({
    data: { name: `QR ag ${stamp}`, email: `qr${stamp}@temp.local`, passwordHash: "none", role: "AGENT" },
  })).id;
  // senha valida precisa do hash — usa a rota de admin para setar
  await call("POST", "/api/auth/login", { email: "admin@empresa.local", password: "admin123" });
  await call("PATCH", `/api/users/${uid}`, { password: "teste1234" });
  await call("POST", "/api/auth/login", { email: `qr${stamp}@temp.local`, password: "teste1234" });
  r = await call("POST", "/api/quick-replies", { shortcut: "x", content: "y" });
  say(r.status === 403, "AGENT: POST (403)", String(r.status));
  r = await call("DELETE", `/api/quick-replies/${replyId}`);
  say(r.status === 403, "AGENT: DELETE (403)", String(r.status));
  await p.user.delete({ where: { id: uid } });

  // deleta resposta (admin)
  await call("POST", "/api/auth/login", { email: "admin@empresa.local", password: "admin123" });
  r = await call("DELETE", `/api/quick-replies/${replyId}`);
  say(r.status === 200, "DELETE admin", String(r.status));
  replyId = null;
  say(true, "OK");
} finally {
  if (replyId) await p.quickReply.deleteMany({ where: { id: replyId } });
  await p.user.deleteMany({ where: { email: `qr${stamp}@temp.local` } });
}
await p.$disconnect();
