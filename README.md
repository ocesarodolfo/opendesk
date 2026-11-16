# Central de Atendimento Multicanal

Sistema de atendimento via WhatsApp para **múltiplos setores** e **múltiplos números** em uma única aplicação, no estilo Chatwoot — atendimento interno e externo centralizado por setor.

## Stack

| Camada | Tecnologia | Observação |
|---|---|---|
| Front-end / Back-end | Next.js (App Router) + TypeScript | API Routes + Server Components |
| Estilo | Tailwind CSS | |
| Banco | SQLite (via Prisma ORM) | Evolução para MySQL: `provider = "mysql"` |
| WhatsApp (não-oficial) | Baileys | Pareamento por QR Code, sessão persistida em disco |
| Tempo real | Server-Sent Events (SSE) | Nativo do Next.js |
| Autenticação | JWT + hash bcrypt, cookie httpOnly | |
| Mídia | Arquivos em `media/` (imagem/áudio/vídeo/doc) | Servidos por rota autenticada `/api/media/...` |
| Futuro | WhatsApp Business / Cloud API da Meta | Arquitetura já preparada — ver `docs/08` |

## Estrutura

```
prisma/            schema, banco e seed
src/app/           telas (login, dashboard, inbox, numeros, setores, usuarios, conta)
src/app/api/       rotas de API (auth, numbers, conversations, media, realtime)
src/lib/           prisma, auth, DTO, barramento SSE, gerenciador WhatsApp, mídia
docs/              documentação, checklists e roadmap
sessions/          credenciais das sessões do WhatsApp (NÃO versionar)
media/             arquivos de mídia das conversas (NÃO versionar)
```

## Como rodar

```bash
npm install
npm run db:push     # cria o banco SQLite
npm run db:seed     # cria o usuário admin + setor padrão
npm run dev         # http://localhost:3000
```

Login padrão: **admin@empresa.local** / **admin123** (troque após o primeiro acesso).

Validação manual rápida (com o servidor rodando e seed aplicado):

```bash
node scripts/smoke-test.mjs 3000   # testa login, APIs, páginas e SSE
node scripts/f3-scope-test.mjs <conversationId>  # teste de escopo por setor (cria e limpa dados temporários)
node scripts/f3-supervisor-test.mjs             # teste do SUPERVISOR + atribuição em lote
node scripts/f3-quick-replies-test.mjs          # teste das respostas rápidas (auto-limpante)
```

> Guia completo: `docs/04-guia-de-instalacao.md`

## Primeiros passos de uso

1. **Setores** → cadastre os setores do seu(O RH, Financeiro, Suporte...).
2. **Números WhatsApp** → cadastre o número do setor e clique em **Conectar** para escanear o QR com o app: *Dispositivos conectados → Conectar dispositivo*. Recomenda-se número dedicado (veja riscos em `docs/07`).
3. **Usuários** → cadastre os atendentes de cada setor.
4. **Inbox** → as conversas chegam em tempo real; o atendimento iniciado assume a conversa e o encerramento a fecha (mensagem nova reabre).

## Módulos prontos (v0.2)

- [x] Login/logout com sessão JWT segura
- [x] Troca de senha na interface (Minha conta)
- [x] Setores e usuários (papéis ADMIN/AGENT)
- [x] Multi-números WhatsApp com pareamento por QR (Baileys)
- [x] Vinculação número ↔ setor
- [x] Inbox: lista com filtros (Pendente/Aberto/Encerrado) e busca
- [x] Recebimento e envio de mensagens em tempo real (SSE)
- [x] **Mídia**: imagem, áudio, vídeo e documento (recebido do celular + enviado pelo painel, até 25 MB)
- [x] **Transferência de conversa** entre atendentes
- [x] **Aviso sonoro** de mensagens em conversas não assumidas (com mudo)
- [x] Fluxo de atendimento (Pendente → Aberto → Encerrado)
- [x] Dashboard com indicadores
- [x] Reconexão automática em quedas transitorias

## Roadmap (próximas fases)

- [ ] Grupos do WhatsApp, respostas rápidas/canned, tags/etiquetas
- [ ] Filtragem de inbox por setor/permissão do atendente
- [ ] Relatórios (SLA, tempo de resposta, volume por setor)
- [ ] WhatsApp Business (Cloud API da Meta) — canal oficial
- [ ] Instagram DM / Telegram / Webchat (a arquitetura de "canais" já contempla)
- [ ] Migração SQLite → MySQL

Detalhes e checklist completo: `docs/06-roadmap-e-checklists.md`

## Documentação

| Arquivo | Conteúdo |
|---|---|
| `docs/01-visao-geral.md` | Objetivos, personas, modelo multicanal |
| `docs/02-arquitetura.md` | Arquitetura, fluxos, decisões técnicas |
| `docs/03-modelo-de-dados.md` | Dicionário de dados + migração para MySQL |
| `docs/04-guia-de-instalacao.md` | Instalação, ambiente, deploy |
| `docs/05-seguranca.md` | Práticas de segurança da informação |
| `docs/06-roadmap-e-checklists.md` | Fases + checklists de dev, testes e go-live |
| `docs/07-operacao-e-suporte.md` | Runbook operacional e troubleshooting |
| `docs/08-integracoes-futuras.md` | Cloud API da Meta e outros canais |
