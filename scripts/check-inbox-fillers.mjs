// Verifica o filtro "Todos" do inbox: login e lista sem `status`
import http from "node:http";

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

const login = await call("POST", "/api/auth/login", { email: "admin@empresa.local", password: "admin123" });
console.log(`login: ${login.status}`);

const all = await call("GET", "/api/conversations?limit=100");
const items = JSON.parse(all.json);
const counts = {};
for (const c of items) counts[c.status] = (counts[c.status] || 0) + 1;

console.log(`GET sem status: ${all.status} | total=${items.length}`);
for (const [st, n] of Object.entries(counts)) console.log(`  ${st}: ${n}`);

// confere cada filtro individual
for (const st of ["PENDING", "OPEN", "CLOSED"]) {
  const r = await call("GET", `/api/conversations?status=${st}`);
  const arr = JSON.parse(r.json);
  const ok = arr.every((c) => c.status === st);
  console.log(`GET status=${st}: ${r.status} | n=${arr.length} | homogeneo=${ok}`);
}
