# 07 — Operação e Suporte (Runbook)

## Rotina diária do administrador

1. **Dashboard** → conferir "Números conectados". Badge `Conectando` persistente = reconexão falhando → POP-01.
2. Se necessário reconectar: **Números → Conectar** → novo escaneio do QR.
3. Aba **Pendente** do Inbox: filas crescendo = falta de atendimento.

## Procedimentos operacionais (POP)

### POP-01 — Reconectar um número
1. Painel (ADMIN) → **Números WhatsApp** → localize o número com status **Desconectado/Conectando**.
2. Clique **Conectar** (se o modal já estiver aberto com "Gerando QR...", aguarde o código).
3. No celular **dedicado** ao número: WhatsApp → Ajustes → **Dispositivos conectados** → **Conectar dispositivo** → escaneie.
4. Status muda para **Conectado** (~5s). Envie uma mensagem de teste do inbox para outro telefone.
> O QR expira em ~1 minuto; clique "Fechar" e "Conectar" de novo para gerar outro.

### POP-02 — Número deslogado no celular (sessão invalidada)
Sintoma: status `Desconectado` + erro "Sessao deslogada no celular".
1. Execute o POP-01 — não há como recuperar a sessão: é obrigatório **novo pareamento**.
2. Se repetir com frequência: o celular do número está desligando/ficando sem rede, ou alguém cancelou o pareamento em "Dispositivos conectados" — alinhar com o dono do número.

### POP-03 — Backup
```bash
# banco (SQLite)
sqlite3 prisma/data/app.db ".backup '/backups/atendimento-$(date +%F).db'"
# sessões de WhatsApp (essenciais para não escanear QR após restauração)
tar czf /backups/sessions-$(date +%F).tar.gz sessions/
# mídias das conversas (imagens/audios/vídeos/documentos servidos no inbox)
tar czf /backups/media-$(date +%F).tar.gz media/
```
Automatizar com cron diário. Teste de restauração **obrigatório** mensalmente:
```bash
cp /backups/atendimento-AAAA-MM-DD.db prisma/data/app.db && npm run start
```

### POP-04 — Atualização da aplicação
```bash
git pull                    # ou copiar os fontes
npm ci
npm run db:push             # em staging primeiro!
npm run build
systemctl restart atendimento   # ou pm2 restart atendimento
```
Faça fora do horário de pico. **Ao voltar, as sessões WhatsApp retomam sozinhas no boot** (hook `src/instrumentation.ts`): números marcados como `CONNECTING/CONNECTED` no banco reconectam a partir da sessão em disco, sem novo QR. Se um número ficar travado em `Conectando`, ver **Troubleshooting** abaixo.

### POP-05 — Remover um número definitivamente
Painel (ADMIN) → Números → **Remover**: desconecta a sessão, apaga as credenciais locais (`sessions/<id>`) e exclui o registro. O histórico das conversas permanece no banco.

## Troubleshooting

| Sintoma | Diagnóstico | Correção |
|---|---|---|
| Mensagens chegam no celular mas não no Inbox | SSE desconectado (buffering do proxy, rede) | Ver na aba Network que `/api/realtime` está em `EventStream`; no nginx use `proxy_buffering off` |
| QR não aparece ("Gerando...") por mais de 30s | Servidor sem saída para os servidores do WhatsApp | Checar firewall/saída 443; ver log do servidor `[whatsapp]` |
| "Numero WhatsApp nao conectado" ao enviar | Sessão caiu depois que a tela carregou | Atualize a página; se persistente, POP-01 |
| `Reconectando (code 440/451)` frequente | Rate limit/bloqueio do WhatsApp | Reduza volume (nada de disparo em massa); avalie migração à Cloud API |
| Número fica "Conectando" para sempre após restart | Sessão em disco foi apagada (`sessions/` removida) ou QR expirado | Abra **Números → Conectar** e escaneie novo QR (a pasta `sessions/` **não** pode ser excluída do servidor) |
| Mensagens não chegam após restart | Sessão não retomou (gasolina: hook de boot falhou antes do fix) | Versões antigas exigiam conectar manualmente; o boot retoma agora automaticamente. Se persistir, POP-01 |
| Mensagens de contato novo não chegam, nada no log | Jid `@lid` da conta nova do WhatsApp | Tratado: contato criado pelos dígitos do LID com `Contact.jid` salvo; respostas partem por ele. Número real do cliente só aparece quando uma mensagem vier com `remoteJidAlt` |
| Mensagens param de chegar após editar `manager.ts` com `npm run dev` | **Hot-reload não troca os listeners do socket em execução** — o código novo só vale nos handlers de API; o Baileys segue com o código antigo | Reinicie o processo (`Ctrl+C` + `npm run dev`) após editar `src/lib/whatsapp/manager.ts`; a religação automática no boot restaura a sessão, sem novo QR |
| Inbox lento com muitas conversas | Listagem sem paginação (v0.1 traz 60) | Filtre por status; paginação no roadmap |
| Ninguém consegue login | `JWT_SECRET` trocado ou banco recriado sem seed | `npm run db:seed`; sessões antigas expiram sozinhas |

Logs do servidor: saída do processo (`journalctl -u atendimento -f` com systemd). Linhas de interesse: `[whatsapp]`, `[connect]`.

## Métricas de saúde

- Processo Node vivo (systemd/pm2 restarts).
- RAM (~100–300 MB por conexão WhatsApp ativa).
- Disco: `sessions/` cresce pouco; `prisma/data/app.db` cresce com as conversas.
- Erros/latência em `/api/realtime` (logs do proxy).

## Riscos do canal não-oficial (lembretes operacionais)

- O número do sistema **não pode** estar pareado em outro WhatsApp Web/Desktop: o pareamento é transferido para o servidor.
- Evitar disparo em massa e spam de desconhecidos — sinais típicos de banimento.
- Ter plano B por setor (número reserva e comunicar contato por outros meios).
- Risco desaparece na migração ao canal oficial (Cloud API) — plano em `docs/08`.
