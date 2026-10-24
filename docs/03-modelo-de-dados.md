# 03 — Modelo de Dados

Schema em `prisma/schema.prisma`. SQLite **não tem enum nativo** — os campos de status usam `String` com valores fixos documentados abaixo.

## Diagrama de relações

```
Sector ◄─── WhatsAppNumber ◄─── Conversation ──► Message
   ▲                  │               │▲
   │                  └─ (sectorId)   ││──► Contact
   │                                  ││
User ◄── SectorMembership ──► Sector  │└──► User (assignedUser)
  ▲                                   │
  └────────── (assignedUserId) ───────┘
```

## Dicionário

### User
| Campo | Tipo | Observação |
|---|---|---|
| `id` | uuid | PK |
| `name`, `email` | string | e-mail único, credencial de login |
| `passwordHash` | string | bcrypt cost 12 |
| `role` | `"ADMIN"` \| `"AGENT"` | ADMIN gerencia setores/números/usuários |
| `active` | bool | inativação (soft delete) |
| `memberships` | → | vínculos com setores (`SectorMembership`) |
| `assignedConversations` | ← | conversas atribuídas a ele |

### Sector
Setor da empresa (RH, Financeiro...). `name` único, `active` para inativação, contadores e relações: `memberships`, `numbers`, `conversations`.

### SectorMembership
Vínculo N:N usuários↔setores (`@@unique([userId, sectorId])`). Campo `role` reservado para granularidade futura (Supervisor do setor).

### WhatsAppNumber
Um número de WhatsApp por registro.

| Campo | Valores |
|---|---|
| `label` | nome de exibição ("Suporte — 5511999990000") |
| `phone` / `jid` | preenchidos pelo gerenciador após conectar |
| `status` | `DISCONNECTED` · `CONNECTING` · `CONNECTED` |
| `lastError` | último erro reportado pela conexão (p/ diagnóstico) |
| `sectorId` | setor responsável pelas conversas do número |

Desenhado como **entidade de canal genérica**: na fase 2 os números oficiais (Cloud API) entram aqui sem mexer no inbox.

### Contact
Contato externo (cliente/colaborador). `phone` = só dígitos com DDI (`5511...`, chave única), `name` editável pelo atendente, `pushName` = nome do WhatsApp.

### Conversation
| Campo | Observação |
|---|---|
| `status` | `PENDING` · `OPEN` · `CLOSED` |
| `lastMessageAt` | índice `@@index([status, lastMessageAt])` p/ fila |
| `whatsappNumberId` + `contactId` | par que identifica a conversa |
| `sectorId` | herdado do número na criação |
| `assignedUserId` | agente responsável |

Regras:
- Mensagem nova em conversa `CLOSED` → conversa volta a `PENDING` (reabre).
- "Iniciar atendimento" → `OPEN` + atribui o próprio atendente.

### Message
| Campo | Observação |
|---|---|
| `direction` | `INCOMING` (recebido) · `OUTGOING` (enviado pelo painel **ou** respondido pelo próprio celular) |
| `content` | texto da mensagem e/ou legenda da mídia |
| `mediaUrl` | nome do arquivo em disco (`media/<mediaUrl>`) quando a mensagem tem mídia |
| `mediaType` | mimetype (`image/jpeg`, `audio/mp4`, `application/pdf`...) |
| `fileName` | nome original do arquivo de documento (se houver) |
| `status` | `SENT` · `FAILED` (evolui para DELIVERED/READ) |
| `externalId` | id da mensagem no WhatsApp — deduplicação |
| `createdAt` | timestamp da mensagem real (do WhatsApp), não do recebimento |

Arquivos de mídia ficam na pasta `media/` (`MEDIA_DIR`) e são servidos **apenas autenticados** por `GET /api/media/[name]` (a rota valida o padrão do nome contra path traversal). Considerar esse diretório no backup (POP-03) e na política de retenção LGPD.

## Migração SQLite → MySQL (checklist)

1. Troque no `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "mysql"
     url      = env("DATABASE_URL") // mysql://user:pass@host:3306/central
   }
   ```
2. Remova/ajuste campos `String` muito longos para `@db.Text` quando necessário (ex.: `Message.content`).
3. `DATABASE_URL` no `.env` apontando para o MySQL.
4. `npx prisma migrate diff --from-sqlite --to-schema-datamodel prisma/schema.prisma --script > migration.sql` (opcional, p/ comparar).
5. `npx prisma migrate deploy` com a pasta de migrations criada, ou `npx prisma db push` em ambiente novo.
6. Exporte os dados do SQLite (ex.: `sqlite3 .dump` + ajuste de dialeto) **ou** script `prisma` de cópia tabela a tabela via `PrismaClient` (recomendado p/ volume pequeno).
7. Rode o app apontando pro MySQL e valide o checklist de `docs/06` (seção "pós-migração").

> Dica: mantenha os ids `uuid()` — nada de autoincrement pra migrar sem dor de FK.
