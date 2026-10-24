# 05 — Segurança

Checklist vivo: marque o que já está feito e reavalie a cada fase.

## Implementado na v0.1

- [x] Senhas com **bcrypt (cost 12)**, nunca em texto puro.
- [x] Sessão **JWT (HS256)** em cookie `httpOnly`, `SameSite=Lax`, `secure` em produção, TTL 12h.
- [x] `JWT_SECRET` no `.env` (fora do git); erro explícito em produção se fraco/ausente.
- [x] Mensagem genérica de erro no login (não revela existência do e-mail).
- [x] Verificação de sessão em **todas as rotas de API** (401) e páginas (redirect).
- [x] Papéis: ações de gestão (setores/usuários/números) restritas a `ADMIN` — 403 no servidor, não só no menu.
- [x] **Escopo por setor (F3)**: ADMIN vê tudo; AGENT vê apenas conversas dos setores com vínculo (`SectorMembership`) + conversas de números **sem setor** (nível empresa). Aplicado no servidor em: listagem, detalhe, PATCH (status/atribuição), envio de mensagem e mídia — fora do escopo é `403`, e a listagem simplesmente não traz a conversa. Stream SSE (`/api/realtime`) filtra eventos por setor. Troca de **setor** da conversa (transferência entre setores) é exclusiva de ADMIN. Códigos em `src/lib/scope.ts`.
- [x] Regex de telefone/normalização (somente dígitos) antes de qualquer uso com o canal.
- [x] Sessões do WhatsApp (credenciais de pareamento) em pasta ignorada pelo git.
- [x] `.env`, `.db` e `/sessions` no `.gitignore` desde o primeiro commit.
- [x] Inativação (soft delete) de usuários e setores, sem deletes acidentais.
- [x] ADMIN não pode inativar o próprio cadastro (evita travar o acesso).

## Próximas (alvo: antes de usuários reais externos)

- [ ] **Troca de senha na UI** (hoje via API PATCH) + política de senha mínima exibida.
- [ ] Rate-limit no `/api/auth/login` (ex.: 5 tentativas/min/IP — `upstash/ratelimit`, middleware próprio ou fail2ban no nginx).
- [ ] Content-Security-Policy e headers de segurança (via `next.config.ts` + nginx):
      `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, `Referrer-Policy`.
- [ ] HTTPS obrigatório (Let's Encrypt + redirect 80→443) e HSTS.
- [ ] Log de auditoria (tabela `AuditLog`): login falho, envio de mensagem, alteração de cadastro.
- [ ] Backup automático do banco e das pastas `sessions/` (ver runbook `docs/07`).
- [ ] Rotação de `JWT_SECRET` com invalidação controlada de sessões.
- [ ] 2FA (TOTP) para administradores.

## Risco inerente: canal não-oficial (Baileys)

- O pareamento por QR usa o protocolo do **WhatsApp Web Multi-Device**, não é API oficial → **viola os Termos de Uso** e pode resultar em banimento do número.
- Mitigações operacionais:
  1. **Número dedicado** por setor (nunca o número pessoal de alguém).
  2. Quota de envio conservadora, sem disparo em massa (a ferramenta **não é** para marketing).
  3. Plano de migração para o canal oficial (Cloud API) registrado em `docs/08`.
  4. Consentimento informado da gestão sobre o risco do canal.

## Dados e privacidade (LGPD)

- A ferramenta armazena **conversas com terceiros**: restringir acesso interno por papel/setor (roadmap de permissões) e definir prazo/forma de descarte de histórico.
- Fornecer aos contatos a informação de que conversam com um sistema de atendimento da empresa.
- [ ] TODO interno: política de retenção e exportação/arquivamento anônimo de dados mais antigos que X dias.

## Segurança do servidor

- [ ] Node atualizado (LTS) e dependências auditadas (`npm audit` no CI).
- [ ] Firewall: apenas 22/80/443 abertos; banco e arquivo de sessões não expostos.
- [ ] Processo sem privilégios (`www-data`/usuário dedicado).
- [ ] `next build` sem `--debug`; `NODE_ENV=production` sempre.
- [ ] Restrição de `robots.txt` (interface operacional não deve ser indexada).

> **Nunca** compartilhe a pasta `sessions/` ou o `.env`: quem tem essas credenciais fala como o WhatsApp da empresa.
