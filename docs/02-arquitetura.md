# 02 — Arquitetura

## Visão macro

```
┌──────────────────────────────────────────────────────────────┐
│  BROWSER (atendentes/admins)                                 │
│  Next.js App Router + Tailwind (React 19)                    │
│  ─ inbox ● SSE /api/realtime                                 │
└──────────────▲───────────────────────────────▲───────────────┘
               │ fetch (REST)                  │ SSE (eventos)
┌──────────────▼───────────────────────────────▼───────────────┐
│  SERVIDOR Next.js (Node)                                     │
│                                                              │
│  API Routes                    Núcleo                        │
│  ├ /api/auth/*                 ├ src/lib/auth.ts  (JWT)      │
│  ├ /api/numbers/*              ├ src/lib/realtime.ts (bus)   │
│  ├ /api/conversations/*        ├ src/lib/whatsapp/manager.ts │
│  ├ /api/sectors|users/*        └ src/lib/prisma.ts           │
│  └ /api/realtime (SSE)                                       │
│                 │                                    │       │
└─────────────────┼────────────────────────────────────┼───────┘
                  ▼                                    ▼
        ┌──────────────────┐              ┌───────────────────────┐
        │ Prisma ORM       │              │ sessões do WhatsApp    │
        │ SQLite → MySQL   │              │ ./sessions/<id> (disk) │
        └──────────────────┘              └───────────────────────┘
                                                    ▲
                                                    ▼
                                        Servidores do WhatsApp
                                        (protocolo multi-device)
```

## Decisões técnicas

| Tema | Escolha | Por quê |
|---|---|---|
| Canal não-oficial | **Baileys** (`@whiskeysockets/baileys`) | Pareamento por QR sem Chromium; leve para VPS pequenas; protocolo multi-device |
| Tempo real | **SSE** | Nativo do Next.js, sem servidor extra, reconexão automática do lado do browser |
| ORM | **Prisma** | Migração SQLite → MySQL é trocando `provider` no schema |
| Sessão de usuário | **JWT via `jose`**, cookie `httpOnly` | Sem estado no servidor; `SameSite=Lax` + `secure` em produção |
| Senhas | **bcryptjs** (cost 12) | Padrão sólido |
| Persistência da sessão WhatsApp | **`useMultiFileAuthState`** (arquivos em `./sessions/<id>`) | Sobrevive a restart do Node sem novo QR |
| Tipografia da UI | **Fonte mínima 12px (`text-xs`)** | Legibilidade; nada de `text-[10px]`/`text-[11px]` em telas novas — quando faltar espaço, ajusta-se o espaçamento, não a fonte |

## Componentes-chave

### 0. `src/instrumentation.ts` — boot

Ao subir o processo, números com status `CONNECTING/CONNECTED` no banco são **retomados automaticamente** a partir da sessão em disco — restart não exige re-escanear o QR. As listagens de números também cruzam o status do banco com o status real do manager (evita mostrar "Conectado" sem socket vivo).

### 1. `src/lib/whatsapp/manager.ts` — gerenciador de sessões

- Mantém **um mapa `numberId → sessão`** em `globalThis` (sobrevive ao hot-reload do dev).
- `connect(numberId)`: sobe o socket Baileys do número e emite QR.
- **Jids `@lid`**: contas novas do WhatsApp entregam conversas como `<id>@lid`; o manager aceita os dois formatos, guarda o jid real em `Contact.jid` e responde por ele. Quando o contato só vem com `@lid` (sem o telefone em `remoteJidAlt`), o contato é criado com os próprios dígitos do LID como `phone` — a conversa funciona, mas o número real do cliente só fica disponível quando chega mensagem com `remoteJidAlt`.
- **Backfill limitado**: após o pareamento o WhatsApp sincroniza o histórico inteiro da conta; mensagens com mais de 24h **não** entram no inbox (corte `MAX_BACKFILL_AGE_MS`). Mensagens reenviadas são deduplicadas por `externalId`.
- Eventos:
  - `connection.update` → estado (CONNECTING/CONNECTED/DISCONNECTED), persiste telefone no banco, reconexão automática a cada 5s em quedas transitorias; `logout` no celular (código 401) invalida a sessão em disco.
  - `messages.upsert` → extrai texto, faz upsert de `Contact`, cria reutilizando conversa `PENDING/OPEN` existente ou reabrindo conversa `CLOSED` como `PENDING`, grava `Message` e emite SSE.
- `sendMessage(numberId, phone, text)`: usado pela API de envio.
- `logout(numberId)`: desconecta e apaga credenciais locais.

> O gerenciador é **agnóstico de canal no acoplamento**: para adicionar outro canal (Cloud API etc.), cria-se um `connector` equivalente que grava nas mesmas tabelas e emite no mesmo barramento.

### 2. `src/lib/realtime.ts` — barramento SSE

- `EventEmitter` singleton em `globalThis`.
- Produtores: gerenciador WhatsApp (mensagens/conexão) e rotas de API (_PATCH conversa, envio).
- Consumidor: `GET /api/realtime` (SSE) re-passa eventos para o browser com heartbeat a cada 25s.
- Eventos do contrato:
  - `connected` — abertura do stream
  - `message:new { conversationId, message }` — `message` inclui `direction`, `content`, `mediaUrl`, `mediaType`, `fileName` e `conversationStatus` (base p/ aviso sonoro)
  - `conversation:update { conversationId, status }`
  - `connection:update { numberId, status }`

### 3. `src/lib/auth.ts` — autenticação

- `hashPassword`/`verifyPassword` (bcrypt), `createSession`/`getSession` (JWT assinado com `JWT_SECRET`, TTL 12h), `requireSession` (Server Components) e `requireApiSession`-equivalente nas rotas (401 quando ausente).
- Middleware `src/middleware.ts` só faz **presença** de cookie para UX de redirect; a validação real do JWT acontece em páginas e APIs.

### 4. Camada de API

| Rota | Métodos | Função |
|---|---|---|
| `/api/auth/login` · `/api/auth/logout` | POST | Autenticação |
| `/api/sectors` (+`/[id]` PATCH) | GET/POST | Gestão de setores (ADMIN) |
| `/api/users` (+`/[id]` PATCH) | GET/POST | Gestão de usuários (ADMIN); PATCH também aceita `sectorIds` (vínculos) |
| `/api/numbers` | GET/POST | Listar/cadastrar números (ADMIN) |
| `/api/numbers/[id]` | DELETE | Remover número + sessão |
| `/api/numbers/[id]/connect` | POST/DELETE | Conectar (QR) / desconectar |
| `/api/numbers/[id]/status` | GET | Polling de status + QR (data URL) |
| `/api/conversations` | GET | Lista com filtro `status`/`q` — sem `status` = todas; **escopo por setor** |
| `/api/conversations/[id]` | GET/PATCH | Detalhe + mensagens; status/agente/**setor (só ADMIN)**; 403 fora do escopo |
| `/api/me` | GET | Sessão atual (`id`, `name`, `role`) — a UI usa p/ exibir controles de ADMIN |
| `/api/contacts/[id]` | PATCH | Renomear contato (`name`, `null` volta ao pushName) e **trocar etiquetas** (`tagIds: string[]` substitui o conjunto) — ✏️ e chips do inbox |
| `/api/tags` · `/api/tags/[id]` | GET/POST · PATCH/DELETE | Etiquetas globais (CRUD ADMIN; agentes só leem/vinculam) |
| `/api/relatorios/export` | GET | Export CSV do relatório do período (`?range=hoje|7d|30d`) — ADMIN |
| `/api/conversations/bulk` | PATCH | **Atribuição em lote** (SUPERVISOR do setor destas conversas ou ADMIN); máx. 50 |
| `/api/quick-replies` (+`/[id]`) | GET/POST · PATCH/DELETE | Respostas rápidas: lista p/ inbox (escopo: empresa + setores do usuário); CRUD só ADMIN |
| `/respostas` (página) | — | Gestão de respostas rápidas (ADMIN): atalho, mensagem, setor ou global |
| `/relatorios` (página) | — | Relatórios ADMIN: volume, encerramentos, 1ª resposta, por setor/por atendente (`?range=hoje|7d|30d`) |
| `/api/conversations/[id]/messages` | POST | Enviar mensagem de texto (com checagem de escopo) |
| `/api/conversations/[id]/react` | POST | Reagir (`{ messageId, emoji }`; emoji `""` remove) — envia pelo WhatsApp e sincroniza bolha via SSE `message:update` |
| `/api/conversations/[id]/media` | POST | Enviar imagem/áudio/vídeo/doc (multipart, 25 MB) |
| `/api/media/[name]` | GET | Servir arquivo de mídia (autenticado; `?download=1`) |
| `/api/auth/password` | PATCH | Troca de própria senha (exige senha atual) |
| `/api/realtime` | GET | Stream SSE (autenticado, eventos filtrados por setor) |

Regra de escopo (`src/lib/scope.ts`): **ADMIN** vê tudo; **AGENT** vê as conversas dos setores em que tem vínculo (`SectorMembership`) e as de números sem setor. Detalhes em `docs/05` (segurança) e `docs/07` (runbook).

### 5. Telas

- `/login`, `/dashboard`, `/inbox`, `/relatorios` (ADMIN), `/numeros`, `/setores` e `/usuarios` (as duas últimas só ADMIN no menu; a guarda real fica na API).

## Limitações conhecidas da v0.3

1. **Mídia**: imagens/áudio/vídeo/docs funcionam; stickers, localização e contatos compartilhados ainda são descartados (roadmap).
2. **Grupos (`@g.us`) — suportados desde v0.3**: cada grupo vira uma `Conversation` com `Contact.isGroup = true` (chave = dígitos do id do grupo); `Contact.name` é o subject do grupo (via `groupMetadata`) e cada mensagem guarda `Message.senderName` (quem falou, exibido na bolha). Respostas do atendente vão para o jid do grupo (já roteado por `Contact.jid`). O histórico anterior ao pareamento entra só dentro da janela de 24h. Fora de escopo ainda: menções/quotes renderizados, remoção de participante, mensagens de sistema (entrada/saída de membros).
3. **Escalabilidade vertical**: SSE + Baileys exigem **instância única** (stateful). Para escalar: Redis (pub/sub de eventos) + worker separado para o Baileys — arquitetura já descrita em `docs/08`.
4. **Permissão por setor nos dados** ✅ F3: AGENT vê só conversas dos setores com vínculo (`SectorMembership`) + números sem setor; ADMIN vê tudo (`src/lib/scope.ts`).
5. **Logs**: console.log; integrar arquivos estruturados (pino) em produção.
6. **Retenção de mídia**: arquivos em `media/` não expiram; implementar política de descarte junto com LGPD (docs/05).
