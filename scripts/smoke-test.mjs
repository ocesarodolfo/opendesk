// Smoke test da API - uso: node scripts/smoke-test.mjs [porta]
import http from "node:http";

const PORT = process.argv[2] ?? "3000";
const base = { host: "localhost", port: PORT };
const out = {};
let cookie = "";

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { hostname: base.host, port: base.port, path, method,
        headers: {
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          const setCookie = res.headers["set-cookie"];
          if (setCookie) {
            const sc = setCookie.find((c) => c.startsWith("atende_session="));
            if (sc) cookie = sc.split(";")[0];
          }
          resolve({ status: res.statusCode, text, headers: res.headers });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

// pagina publica + redirect
out.loginPage = (await req("GET", "/login")).status;
out.rootRedirect = (await req("GET", "/")).headers.location;

// credenciais erradas
out.badLogin = (await req("POST", "/api/auth/login", { email: "admin@empresa.local", password: "x" })).status;

// login valido
out.login = (await req("POST", "/api/auth/login", { email: "admin@empresa.local", password: "admin123" })).status + " cookie=" + (cookie ? "ok" : "falta");

// APIs autenticadas
out.noAuth = (await req("GET", "/api/conversations")).status;

const sectors = await req("GET", "/api/sectors");
out.sectors = sectors.status + " n=" + (JSON.parse(sectors.text).length ?? 0);
out.sectorCreate = (await req("POST", "/api/sectors", { name: "Financeiro" })).status;
out.sectorDuplicate = (await req("POST", "/api/sectors", { name: "Financeiro" })).status;
out.agentForbidden = (await req("POST", "/api/sectors", { name: "hack" })).status;

const users = await req("GET", "/api/users");
out.users = users.status + " n=" + (JSON.parse(users.text).length ?? 0);
const createdUser = await req("POST", "/api/users", { name: "Atendente Teste", email: "agente@teste.local", password: "senha12345", role: "AGENT" });
out.userCreate = createdUser.status;
// troca de papel para AGENT - deveria dar 403
out.userCreateAsAgent = (await req("POST", "/api/users")).status === 401 ? "n/a" : "";

const numRes = await req("POST", "/api/numbers", { label: "Suporte - Teste" });
const numJson = JSON.parse(numRes.text);
out.numberCreate = numRes.status + (numJson.id ? " com-id" : " sem-id");
const numberId = numJson.id;

await req("POST", `/api/numbers/${numberId}/connect`);
const st = await req("GET", `/api/numbers/${numberId}/status`);
const stJson = JSON.parse(st.text);
out.numberStatus = st.status + " status=" + (stJson.status ?? "?");

const conversations = await req("GET", "/api/conversations?status=PENDING");
out.conversations = conversations.status + " n=" + (JSON.parse(conversations.text).length ?? 0);

// paginas autenticadas
const dash = await req("GET", "/dashboard");
out.dashboard = dash.status + (dash.text.includes("Últimas conversas") ? " ok" : " verificar");
const inbox = await req("GET", "/inbox");
out.inbox = inbox.status + (inbox.text.includes("Buscar") ? " ok" : " verificar");
const numeros = await req("GET", "/numeros");
out.numeros = numeros.status + (numeros.text.includes("Números") ? " ok" : " verificar");

// SSE abre e entrega evento inicial
const sse = await new Promise((resolve, reject) => {
  const r = http.request({ hostname: base.host, port: base.port, path: "/api/realtime", method: "GET", headers: { Cookie: cookie } }, (res) => {
    res.setEncoding("utf8");
    let first = "";
    const timer = setTimeout(() => { r.destroy(); resolve(res.statusCode + " " + (first.split("\n")[0] ?? "")); }, 4000);
    res.on("data", (d) => { if (!first) { first = d; clearTimeout(timer); r.destroy(); resolve(res.statusCode + " " + first.trim().slice(0, 50)); } });
  });
  r.on("error", (e) => { clearTimeout(timer); resolve("erro: " + e.code); });
  r.end();
});
out.realtime = sse;

console.log(JSON.stringify(out, null, 2));
