# 06 — Roadmap e Checklists

## Fases

| Fase | Escopo | Status |
|---|---|---|
| **F1 — Fundação** | Auth, setores, usuários, multi-número, inbox texto, SSE, dashboard, docs | ✅ Feita |
| **F2 — Inbox essencial** | Mídia (imagem/doc/áudio/vídeo), transferência de conversa entre atendentes, notificação sonora, troca de senha na UI | ✅ Feita |
| **F3 — Multisetor em operação real** | Permissão de inbox por setor, supervisor por setor, relatórios (SLA/ volume/ tempo de resposta) | ⬜ Próxima |
| **F4 — Canal oficial** | WhatsApp Cloud API (Meta), webhooks, templates, fallback→canal não-oficial removido | ⬜ |
| **F5 — Multi-canais** | Telegram, Instagram Direct, Webchat próprio | ⬜ |
| **F6 — Infra/escala** | MySQL, Redis pub/sub, Baileys em worker separado, sharding por canal | ⬜ |

---

## Checklist de desenvolvimento (modelo para qualquer PR)

### Backend
- [ ] Sessão verificada em toda rota nova (`401` sem login, `403` sem papel).
- [ ] Validação de entrada (tipos/tamanhos) antes de Prisma/route handler.
- [ ] Erros com mensagem amigável + `console.error` do detalhe técnico.
- [ ] Dados novos **sempre** com índice no campo usado para listagem/ordenação.

### Frontend
- [ ] Estados de vazio/lista não-travada (sem "spinner infinito").
- [ ] Mensagens de erro exibidas ao usuário (não silência fetch).
- [ ] Testado fluxo em tela estreita (celular) quando mexe no inbox.

### Segurança
- [ ] Nenhum segredo no código/print.
- [ ] Nova rota de gestão tem checagem `ADMIN` no servidor.

### Documentação
- [ ] Nova tabela/campo → atualizar `docs/03`.
- [ ] Nova rota → atualizar tabela da `docs/02`.
- [ ] Procedimento operacional novo → `docs/07`.

---

### Backlog F2 (encerrada em v0.2)
- [x] Mídia recebida do celular: imagem, áudio (voz/música), vídeo e documento exibidos no inbox.
- [x] Envio de mídia pelo painel (botão 📎; imagem/vídeo com legenda opcional; doc mantém nome original).
- [x] Validação de upload: tipo aceitável (allowlist de documentos + prefixos image/video/audio), máx. 25 MB.
- [x] Arquivos de mídia servidos apenas a usuários logados, protegidos contra path traversal.
- [x] Transferência de conversa entre atendentes (seletor no cabeçalho da conversa).
- [x] Aviso sonoro para mensagem recebida em conversa ainda não assumida, com opção de mudo persistente.
- [x] Troca de senha via UI (Minha conta), exigindo senha atual.
- [x] Módulos/documentação atualizados (schema, arquitetura, runbook).

### Correções pós-teste real (v0.2.1)
- [x] Jids `@lid` (conta nova do WhatsApp) aceitos no ingest; `Contact.jid` guarda o jid real e **responde por ele** (fallback: telefone como antes).
- [x] Religação automática no boot (`src/instrumentation.ts`) — restart do processo não pede QR de novo.
- [x] Status honesto no painel: listagens cruzam banco × status ao vivo ( CONNECTED "colado" no banco pós-restart exibe Desconectado).
- [x] Backfill limitado a 24h — histórico do pareamento não inunda o inbox; dedupe por `externalId`.
- [x] Remoção de número tolerante (sem 500 quando já foi removido em outra aba).
- [x] Arena de mensagens com contraste adequado (bolhas com borda + tons mais escuros).

### Backlog F3 (próxima fase)
- [x] Inbox restringido por setor conforme vínculos do atendente (SectorMembership) — aplicado em listagem, detalhe, PATCH, envio, mídia, dashboard e filtro de eventos SSE (`src/lib/scope.ts`). Conversas de número **sem setor** ficam visíveis a todos (nível empresa). Transferência entre setores somente ADMIN.
- [x] UI de vínculos: tela **Usuários** ganhou coluna "Setores" (chips por usuário) + editor com checkboxes (PATCH `/api/users/[id]` aceita `sectorIds: string[]`). ADMIN sempre visível a tudo por papel. Testado via `scripts/f3-scope-test.mjs` (11 asserções, auto-limpante).
- [x] Inbox com aba **Todos** (4 abas: Todos/Pendente/Aberto/Encerrado) — listagem sem `status` já era suportada pelo servidor; verificado via `scripts/check-inbox-fillers.mjs`.
- [x] **Grupos (`@g.us`) no inbox (v0.3)** — necessário p/ integração entre empresas: contato = grupo (`Contact.isGroup`), nome = subject do grupo, remetente por mensagem (`Message.senderName`) e respostas via jid do grupo. Entra na fila/setor do número normalmente. Fora de escopo: menções renderizadas, mensagens de sistema (entrada/saída). **Testado com grupo real** ("GRUPO IMÓVEIS VENDAS EM GUARAPARI"): ingest, nome do grupo e remetente confirmados em produção.
- [x] **Transferência entre setores na UI**: seletor "Setor" no cabeçalho da conversa (visível só a ADMIN — a API bloqueia AGENT com 403). Usado também p/ resolver conversas de grupo que entraram em número sem setor. Rota nova de apoio: `GET /api/me` (papel da sessão).
- [x] **Relatórios** (F3-2): página `/relatorios` (ADMIN) com KPIs — conversas criadas/encerradas no período (`Conversation.closedAt`, novo campo), tempo de **1ª resposta** (média), mensagens recebidas/enviadas, volume diário (gráfico CSS), por setor e por atendente. Períodos: hoje/7d/30d. Verificado `GET /relatorios?range=*` = 200 nos três.
- [x] **Renome de contato** (F3-4): ✏️ no cabeçalho do inbox + `PATCH /api/contacts/[id]` (`name` ou `null` = volta ao pushName). Testado E2E.
- [x] **Fix mídia**: download de mídia quebrava no Baileys 6.7 (`socket.downloadMediaMessage` virou utilitário exportado) — corrigido p/ `downloadMediaMessage(msg, "buffer", {})` em `manager.ts`. Mídia de grupo (imagem/áudio/doc) volta a gravar em `media/`.
- [x] **Papel SUPERVISOR por setor** (F3-1): `SectorMembership.role = "SUPERVISOR"` (editor na tela Usuários: checkbox + Atendente/Supervisor por setor). Poder: **atribuição em lote** no inbox — botão ☑ Lote (visível a ADMIN e supervisores) marca conversas e atribui a um atendente de uma vez (`PATCH /api/conversations/bulk`, máx 50, 403 fora dos setores supervisionados). Monitoria já é coberta pelo escopo por setor. Teste: `scripts/f3-supervisor-test.mjs` — 11/11 PASS.
- [x] **Respostas rápidas** (F3-3): tabela `QuickReply` (atalho + mensagem, global ou por setor). Gestão em `/respostas` (ADMIN, menu). Inbox: botão ⚡ abre lista do escopo do usuário; clicar preenche o campo de envio. Teste: `scripts/f3-quick-replies-test.mjs` — 9/9 PASS.
- [x] **Colar mídia da área de transferência** (inbox): Ctrl+V de imagem/vídeo/áudio no campo de envio (≤25 MB) envia direto como mídia (com o texto do campo como legenda, se houver) — igual WhatsApp Web. Texto colado segue caminho normal. Validar manualmente: Ctrl+V de print no inbox.
- [x] **Dark mode com seletor** (claro/escuro/sistema): `ThemeToggle` no menu (☀️/🌙/🖥️), preferência em `localStorage.atende_theme` + script anti-flash no HTML inicial; modo escuro por inversão CSS das superfícies utilitárias em `globals.css` (sem reescrever telas). `darkMode: "class"` no Tailwind. **Ajuste de contraste das bolhas do chat no escuro**: recebidas `#3a445e`, enviadas esmeralda escuro `#155e4c` (texto claro), citação e chip de reação com fundo próprio (combos `classe1.classe2` para não afetar abas/outros usos de `bg-slate-200`).
- [x] **Som de notificação configurável**: seletor no inbox (Clássico · Ping · Campainha · Pop), sintetizados via WebAudio (sem arquivos), prévia ao trocar e persistência em `localStorage.atende_sound`. Mudo continua persistente.
- [x] **Etiquetas do contato**: `Tag` + `ContactTag` (N:N); CRUD ADMIN em `/api/tags` (+`/api/tags/[id]`), agentes vinculam/desvinculam no cabeçalho do inbox (chips coloridos + ✕, "＋ etiqueta" com datalist; ADMIN cria sob demanda). Contato guarda o conjunto atual via `PATCH /api/contacts/[id] { tagIds[] }`.
- [x] **Export CSV dos relatórios**: botão ⬇ nas páginas de período (`/api/relatorios/export?range=`), com BOM UTF-8, seções KPIs/volume diário/por setor/por atendente, nome `relatorio-<periodo>-<data>.csv`.
- [x] **Rate limit no login** (hardening): 8 tentativas por IP / 15 min (em memória por processo), `429` com `Retry-After`, contador zerado no sucesso. Produção multi-instância: trocar por Redis (ver docs/05).
- [x] **RESPOSTA QUOTED renderizada no inbox** — recado do usuário de que "responder não fica claro": mensagens de texto/mídia com quote mostram bloco cinza com telefone de quem citou + trecho da mensagem citada (`Message.quotedSnippet`/`quotedSender`, extraído do `contextInfo.quotedMessage`).
- [x] **REAÇÕES nas mensagens (v2 impulsora)**: reação recebida (protocolMessage type=REACT) grava emoji na mensagem alvo (`Message.reaction`/`reactionMine`, última por autor vence, mesmo emoji do mesmo autor remove) e atualiza a bolha via SSE `message:update`. Painel envia reação: botões 👍❤️😂🙏 no hover da bolha (`POST /api/conversations/[id]/react` → `waManager.sendReaction`, `key` do alvo + participante em grupo). Reagir exige número conectado (503 caso contrário).
- [x] **NÚMERO REAL no lugar do id (LID)**: ingest usa `key.remoteJidAlt` → `key.participantPn` → `key.senderPn` (attrs `sender_pn`/`participant_pn` da wire) e migra o contato criado com dígitos do LID para o telefone real (histórico mantido; `Contact.jid` segue o jid LID p/ envio). Tela mostra com máscara `+55 (27) 99999-9999` (`formatPhone`). Limitação Baileys 6.7: alguns chats chegam só com LID até o primeiro envio do contato por PN (migração é automática na primeira mensagem que tráz o número).
- [x] Papel SUPERVISOR por setor (fila, atribuição em lote, monitoria de conversas).
- [x] Transferência de conversa entre setores/números (seletor de setor no cabeçalho do inbox, somente ADMIN).
- [x] Relatórios: tempo de 1ª resposta, resoluções por atendente, volume por dia (export CSV incluído).
- [x] Gravação de nome do contato editável pelo atendente (Contact.name).
- [x] **Visualizador de imagem com zoom (inbox)**: clique na bolha da imagem → tela cheia (`ImageViewer`): roda do mouse = zoom (1x–8x), arraste = navegar, botões −/%/+, duplo clique/Esc resetam/fecham. Visual refinado: fundo escuro com blur + fade, foto com animação de entrada e sombra, barra de ações em "vidro" (pílula com −/zoom/+/⬇ baixar), dica de uso discreto. Estado derivo do `MessageBubble` via `onOpenImage` (`viewerSrc` no `InboxClient`).
- [x] **Respostas rápidas (templates do atendente com atalhos /1 /2...)**.
- [x] **Fix "conversa comigo mesmo" ao mandar mensagem pelo celular**: sync offline do Baileys 6.7 repassa cópias das mensagens enviadas pelo celular com `remoteJid` = o **LID do próprio número** (stanza `category=peer` sem `recipient`) e o ingest criava contato/conversa self. Correção: `syncSelfIdentity` lê `creds.me` (`me.id` PN + `me.lid`) no boot e no `open`, e o ingest descarta 1:1 cujos dígitos = próprios. **Atenção: `me.id`/`me.lid` vêm com o device junto (`5527...:25@s.whatsapp.net`) — fatiar o `:device` antes do `digitsOnly`, senão o filtro não casa.** Limpeza de lixo antigo: `node scripts/clean-self-chat.mjs`. Bônus: o `phone`/`jid` do número no DB volta a ser gravado (antes `connection.update` não trazia `user` nessa versão → ficava `?`).
- [x] **Preview da última mensagem na lista de conversas**: `ConversationDTO.lastMessage` (o campo só existia no tipo client → a lista mostrava "(sem texto)" sempre). O `GET /api/conversations` inclui a última mensagem (`messages: { orderBy desc, take 1 }`) e `lastMessagePreview` formata: texto; mídia sem legenda vira `📷 Foto` / `🎥 Vídeo` / `🎵 Áudio` / `📄 Documento` / `📌 Figurinha` (`image/webp`/`video/webp`). No detalhe (`[id]`) o preview vem vazio — não é exibido lá.

## Checklist de DEFINITION OF DONE da F1 (fase atual)

- [x] Login/logout funcionando com cookie httpOnly.
- [x] CRUD de setores e usuários com papéis.
- [x] Cadastro de número + conexão por QR + desconexão limpa.
- [x] Reconexão automática em rede cai (sem novo QR).
- [x] Deslogada no celular → instrução de novo QR na UI.
- [x] Receber mensagem → conversa PENDING criada automaticamente.
- [x] "Iniciar atendimento" assume conversa; "Encerrar" fecha.
- [x] Responder pelo inbox chega no celular do contato.
- [x] Responder pelo celular aparece no inbox (OUTGOING do lado do contato).
- [x] SSE de tempo real no Inbox.
- [x] Dashboard com contadores básicos.
- [x] Seed e doc de instalação verificadas em ambiente limpo.

## Checklist de homologação (antes do piloto de um setor)

- [ ] Testes manuais do runbook (`docs/07`) executados por 2 pessoas diferentes.
- [ ] Backup/restauração do `.db` e das `sessions/` testados de verdade.
- [ ] HTTPS acessível fora da rede; SSE funciona atrás do proxy.
- [ ] Número dedicado adquirido e testado (não é pessoal).
- [ ] Gestão ciente+aprovada dos riscos do canal não-oficial (termos WhatsApp e LGPD).
- [ ] Atendentes treinados (como abrir/fechar/buscar no Inbox).
- [ ] Definido downtime máximo aceitável para origem do suporte.

## Checklist pós-migração SQLite → MySQL

- [ ] `provider = "mysql"` e `DATABASE_URL` alterados.
- [ ] Script de carga dos dados executado e **contagens por tabela conferidas** (`User.count === backup.count`).
- [ ] Conversas históricas navegáveis no Inbox após a carga.
- [ ] Seed apontando para o novo banco sem duplicar admin.
- [ ] Gargalos de índice verificados (`EXPLAIN` nas consultas de listagem).

## Templates de issues (copie no tracker)

- `[BUG] Inbox não atualiza em tempo real` — ambiente, passo a passo, logs do servidor e do browser (aba Network → realtime).
- `[FEAT] Suporte a mídia no chat` — tipo de mídia, número afetado, regra de arquivamento.
- `[OPS] Número X desconectado repetidamente` — `lastError`, horários, code do disconnect.
