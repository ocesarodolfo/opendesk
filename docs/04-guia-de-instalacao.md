# 04 — Guia de Instalação

## Requisitos

- Node.js **20+**
- Windows, Linux ou macOS
- Porta 3000 livre (ou configurar `PORT`)

## Desenvolvimento local

```bash
# 1. instalar dependências
npm install

# 2. variáveis de ambiente
cp .env.example .env
#   gere um JWT_SECRET forte:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. banco + seed
npm run db:push     # cria o SQLite em prisma/data/app.db
npm run db:seed     # admin@empresa.local / admin123 + setor "Suporte Geral"

# 4. subir
npm run dev         # http://localhost:3000
```

Ferramentas úteis:

```bash
npm run db:studio   # inspeção visual do banco (http://localhost:5555)
```

## Regras de ouro do desenvolvimento

1. **Nunca rode `npm run dev` e `npm run start` ao mesmo tempo** — dois processos na mesma porta 3000 corrompem `.next` (500s do nada). Uma instância por vez.
2. **Editou `src/lib/whatsapp/manager.ts`? Reinicie o dev** — o hot-reload do Next não troca os listeners do socket Baileys já em execução: o WhatsApp continuaria rodando o código antigo em silêncio. `Ctrl+C` e `npm run dev` de novo; a religação automática no boot (`src/instrumentation.ts`) restaura a sessão em disco, **sem novo QR**.
3. **Nunca apague a pasta `sessions/`** — ela é o pareamento do WhatsApp. Sem ela, é preciso escanear o QR novamente.
4. **Não siga a conversa da sessão por outros clientes**: o número dedicado ao sistema tem o pareamento exclusivo do servidor (ver `docs/07`).

## Primeiro acesso

1. Login com `admin@empresa.local` / `admin123`.
2. **Troque a senha no primeiro uso** (Usuários → editar seu cadastro → PATCH `/api/users/[id]` com `{"password": "..."}`; tela de troca de senha no roadmap).
3. Cadastre os **Setores**, depois os **Números** vinculados a um setor.
4. Clique em **Conectar** no número e escaneie o QR pelo celular:
   WhatsApp → Ajustes → **Dispositivos conectados** → **Conectar dispositivo**.
5. Cadastre os **Usuários** (atendentes) de cada setor — na tela Usuários, botão **Setores** define a quais setores cada atendente tem acesso (o ADMIN vê tudo por papel).

> **Importante**: ao conectar, o WhatsApp Web "sai" de qualquer outro pareamento ativo que use o mesmo número. Use um número **dedicado** ao sistema — ver risco operacional em `docs/07`.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | SQLite: `file:./data/app.db` (relativa à pasta `prisma/`) |
| `JWT_SECRET` | Segredo mínimo de 32 caracteres para assinar sessões |
| `SESSIONS_DIR` | Pasta das credenciais do WhatsApp (default `./sessions`) |

## Produção (setup simples, VPS Linux)

```bash
sudo apt update && sudo apt install -y nodejs npm  # Node 20+
# clonar/copiar o projeto, configurar .env de produção
npm ci
npm run db:push && npm run db:seed
npm run build
npm run start       # porta 3000
```

Recomendações de hardening + proxy reverso (HTTPS, `wss`/stream SSE funciona por HTTPS normal em `/api/realtime`):

```
nginx → proxy_pass http://127.0.0.1:3000;
# cabeçalho essencial para SSE:
#   proxy_set_header Connection keep-alive;
#   proxy_buffering off;   (ou X-Accel-Buffering: no já enviado pela rota)
```

Node em segundo plano: `systemd` (unit) ou `pm2 start npm --name atendimento -- start`.

> Na fase 2 (Cloud API da Meta) o webhook HTTPS passa a ser obrigatório — a certificação TLS válida (Let's Encrypt) já está coberta pelo nginx/caddy.

## Deploy como serviço (systemd, exemplo)

```ini
# /etc/systemd/system/atendimento.service
[Unit]
Description=Central de Atendimento
After=network.target

[Service]
WorkingDirectory=/opt/atendimento
ExecStart=/usr/bin/npm run start
Restart=always
Environment=NODE_ENV=production
# Edita senha do admin/produção interna
User=www-data

[Install]
WantedBy=multi-user.target
```

## Troubleshooting de instalação

| Problema | Causa provável | Solução |
|---|---|---|
| `PrismaClientValidationError` no build | banco não existe | `npm run db:push` |
| Login sempre negado | seed não rodou | `npm run db:seed` |
| QR não aparece | firewall bloqueou websocket do Baileys | ver `docs/07` (portas/DNS) |
| Mensagens não chegam no inbox | SSE desconecta | ver proxy: desativar buffering |
