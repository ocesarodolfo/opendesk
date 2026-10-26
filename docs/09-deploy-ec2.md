# 09 — Deploy em EC2 Linux (AWS)

Guia passo a passo para subir a Central de Atendimento em uma instância EC2 Linux.
Complementa `docs/04` (instalação local) e `docs/05` (segurança).

---

## 0. Visão geral do que você precisa

| Item | Recomendação |
|---|---|
| Instância | **t3.small** (2 GB) mínimo; **t3.medium** (4 GB) recomendado p/ build sem sofrer |
| SO | Ubuntu 22.04/24.04 LTS (ou Amazon Linux 2023) |
| Disco | EBS gp3, 20–30 GB |
| Região | A mais próxima dos usuários (ex.: `sa-east-1` São Paulo) |
| Portas (Security Group) | **22** (SSH, restrito ao SEU IP), **80** e **443** (nginx). A **3000 fica fechada** — o Node só escuta localmente |
| EIP | Elastic IP fixo (senão o IP muda a cada stop/start) |
| DNS | Um domínio apontando (A) pro EIP — **obrigatório para HTTPS** |
| Node.js | **20 LTS** |
| HTTPS | nginx + Let's Encrypt (certbot) — **obrigatório em NODE_ENV=production** (motivo no gotcha 1) |

Custo (on-demand, estimate-1]: t3.small ≈ US$ 30/mês; t3.medium ≈ US$ 60/mês + disco/trafego.
Free tier (12 meses): t2.micro dá para *testar*, mas 1 GB não faz `next build` sem swap.

---

## 1. Criar a instância

1. EC2 → Launch instance → Ubuntu 22.04 LTS (free tier eligible) ou t3.small.
2. Security Group (novo): inbound apenas
   - SSH 22 — **Source: seu IP** (não deixe `0.0.0.0/0`);
   - HTTP 80 e HTTPS 443 — Source `0.0.0.0/0`.
3. Allocate Elastic IP e associe; crie registro DNS tipo **A** apontando o domínio para o EIP.
4. Par de chaves (.pem): guarde com permissão `chmod 400` e **nunca no git**.

## 2. Preparar o servidor (uma vez)

```bash
# Node 20 LTS (Ubuntu)
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx sqlite3
node -v   # >= 20

# build precisa de RAM: em t3.small/micro, crie swap de 2 GB (se ainda nao tem)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# usuario dedicado (sem privilégios) para rodar a aplicação
sudo useradd -r -m -d /opt/atendimento atendimento
```

## 3. Colocar o código no servidor

Se o repositório estiver remoto (GitHub/GitLab):

```bash
sudo git clone <URL> /opt/atendimento
sudo chown -R atendimento:atendimento /opt/atendimento
```

Alternativa (sem repositório remoto): do Windows,

```powershell
rsync -avz --exclude node_modules --exclude .next `
  -e "ssh -i sua-chave.pem" . ubuntu@SEU_EIP:/tmp/app-src/
```

## 4. Configuração de produção

Crie `/opt/atendimento/.env` (fora do git — o `.gitignore` já cobre):

```ini
DATABASE_URL=file:./data/app.db
JWT_SECRET=<gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
SESSIONS_DIR=./sessions
```

Instalar e preparar banco (somente na **primeira** instalação):

> Usando **MySQL/RDS**: troque por `db:generate:mysql` + `db:push:mysql`
> (+ migração de dados), conforme `docs/10-mysql-e-s3.md`. Com **S3**, as
> envs `STORAGE_DRIVER=s3` e credenciais entram no mesmo `.env` carregado
> pelo systemd.

```bash
cd /opt/atendimento
npm ci
npm run db:push     # cria prisma/data/app.db
npm run db:seed     # admin@empresa.local / admin123 -> TROQUE a senha ja no primeiro login
npm run build       # NODE_ENV=production é assumido no start
```

> **Regra de ouro**: `db:push`/`db:seed` só com o serviço **parado** (a DLL do Prisma trava o arquivo). Em updates: `systemctl stop atendimento` → push → `start`.

## 5. Rodar como serviço (systemd)

`/etc/systemd/system/atendimento.service`:

```ini
[Unit]
Description=Central de Atendimento (Next.js + Baileys)
After=network-online.target

[Service]
# NAO usar WorkingDirectory=/opt/atendimento/App root;
WorkingDirectory=/opt/atendimento
EnvironmentFile=/opt/atendimento/.env
Environment=NODE_ENV=production
# TZ de Sao Paulo p/ timestamps das conversas
Environment=TZ=America/Sao_Paulo
ExecStart=/usr/bin/npm run start
User=atendimento
Restart=always
RestartSec=5
# endurecimento
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now atendimento
sudo journalctl -u atendimento -f     # ver logs ao vivo
```

O `instrumentation.ts` religa o WhatsApp automaticamente no boot — **sem novo QR**, desde que a pasta `sessions/` exista.

## 6. nginx (proxy reverso + HTTPS + SSE)

`/etc/nginx/sites-available/atendimento`:

```nginx
server {
  listen 80;
  server_name atendimento.seudominio.com;   # mesmo dominio do DNS
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl http2;
  server_name atendimento.seudominio.com;

  # certificado criado pelo certbot (passo abaixo); ssl_* ele insere sozinho
  ssl_certificate     /etc/letsencrypt/live/atendimento.seudominio.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/atendimento.seudominio.com/privkey.pem;

  client_max_body_size 25m;                  # upload de midia (limit 15MB na API)

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;         # IP real p/ auditoria/rate-limit
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;      # Exige secure cookie correto
    # ESSENCIAL para o SSE (/api/realtime): sem buffering a stream nao "trava"
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 24h;
  }

  # nao permitir uso como scanner/proxy aberto
  add_header X-Frame-Options DENY;
  add_header X-Content-Type-Options nosniff;
  add_header Referrer-Policy same-origin;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/atendimento /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# HTTPS (Let's Encrypt) — emite e renova automaticamente
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d atendimento.seudominio.com
```

Validar renovação: `sudo certbot renew --dry-run` (cron do systemd já vem de brinde).

## 7. Migrar os dados do Windows de desenvolvimento (opcional)

Se quiser levar **conversas, contatos, Etiquetas e o pareamento do WhatsApp** já feitos:

```bash
# 1. LOCAL: pare qualquer servidor (regra de ouro) e empacote
tar -czf dados.tar.gz -C . prisma/data/app.db sessions media

# 2. Copie e no servidor (serviço parado):
sudo systemctl stop atendimento
tar -xzf dados.tar.gz -C /opt/atendimento
sudo chown -R atendimento:atendimento /opt/atendimento/{prisma,sessions,media}
sudo systemctl start atendimento
# WhatsApp religa sozinho no boot — sem QR novo
```

> Se **não** migrar `sessions/`: número novo por setor? Simplesmente conecte tudo de novo pelo QR na tela `/numeros`.

## 8. Backups (agendar já no dia 1)

O estado vive em 3 lugares: `prisma/data/app.db`, `sessions/`, `media/`.

Cron do root (`sudo crontab -e`):

```cron
# 03:30 todos os dias: backup consistente pra /var/backups/atendimento (guarda 7 dias)
30 3 * * * sqlite3 /opt/atendimento/prisma/data/app.db "VACUUM INTO '/var/backups/atendimento/app-$(date +\%a).db'"
31 3 * * * tar -czf /var/backups/atendimento/sessions-$(date +\%a).tgz -C /opt/atendimento sessions
32 3 * * * rclone --max-age 24h copy /opt/atendimento/media rclonebackup:atendimento-midia 2>/dev/null || true
# purga backups com mais de 7 dias
20 3 * * * find /var/backups/atendimento -type f -mtime +7 -delete
```

> `sqlite3` (`VACUUM INTO`) copia o banco com consistência, sem precisar parar o serviço.
> **Teste um restore** no primeiro mês (`sqlite3 copia.db .tables`) — backup não testado não é backup.

## 9. Checklist de go-live

- [ ] `systemctl status atendimento` ativo e **sem** erros no `journalctl -u atendimento`.
- [ ] WhatsApp ligado: log mostra `numero ... conectado (... · lid ...)` — **sem QR novo**.
- [ ] Login **na URL HTTPS pública** funciona (nada de `:3000` no browser).
- [ ] Cookies de sessão têm flag `Secure` (DevTools → Application → Cookies).
- [ ] SSE ativo: inbox atualiza ao vivo sem refresh (se não, revisar `proxy_buffering off`).
- [ ] Porta 3000 NÃO responde de fora (Security Group fechado), só `127.0.0.1`.
- [ ] SSH restrito ao seu IP; autenticação por chave; senha do Ubuntu desabilitada.
- [ ] `sessions/`, `media/` e `.env` com `chmod 600/700` — dono é o usuário `atendimento`.
- [ ] Teste manual: 2–3 atendentes no inbox, 1 upload de foto e 1 áudio, envio real no WhatsApp.
- [ ] Backups agendados (passo 8) e **um restore testado**.
- [ ] Senha do admin já trocada depois do seed.

## 10. Gotchas importantes (experiência viva)

1. **Login "quebra" sem HTTPS.** Em `NODE_ENV=production` o cookie da sessão é `Secure` — navegadores só enviam por HTTPS. Sem dominio/certo válido o login parece "não funciona" (volta pro `/login`).
2. **Nunca rode `next start` + `next dev` juntos** (vám 500s do nada) — nem na mesma máquina, nem em contêineres diferentes do mesmo disco.
3. `db:push` trava o arquivo do banco: só com serviço parado.
4. Release: `git pull` → `npm ci` → `npm run build` → `systemctl restart atendimento` (apagar `.next` antes se der erro estranho: `rm -rf .next && npm run build`).
5. Tamanho de build: em t3.small use o **swap do passo 2** — `next build` sem swap morre com SIGKILL/OOM.
6. Fuso horário: `Environment=TZ=America/Sao_Paulo` evita mensagens "uma hora atrasadas" nos relatórios.
7. `media/` e `sessions/` precisam existir no disco **antes** do primeiro start (o app cria se faltar, mas owner precisa ser o usuário do serviço).
8. Este canal é **não-oficial** (Baileys/WhatsApp Web): não exponha em domínio "público de marketing" e entenda risco de ban do número — ver `docs/05` (seção risco) e `docs/07`.

---

## Fluxo rápido (TL;DR)

```bash
# no EC2 (Ubuntu)
sudo apt install -y nodejs git nginx sqlite3 certbot python3-certbot-nginx
sudo git clone <repo> /opt/atendimento && sudo chown -R atendimento /opt/atendimento
cd /opt/atendimento
cp .env.example .env        # editar JWT_SECRET / DATABASE_URL
npm ci && npm run db:push && npm run db:seed && npm run build

# criar a unit do passo 5 em /etc/systemd/system/atendimento.service, entao:
sudo systemctl daemon-reload && sudo systemctl enable --now atendimento

# nginx baseado no passo 6, entao:
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d atendimento.seudominio.com
```
