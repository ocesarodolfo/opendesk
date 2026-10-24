# 08 — Integrações Futuras

## Fase 2 — WhatsApp Business (Cloud API da Meta)

Canal **oficial** (sem risco de banimento), dividido em duas modalidades:

| Modalidade | Para quem | Destaque |
|---|---|---|
| Cloud API (hospedado pela Meta) | Recomendada | Sem servidor próprio; webhooks + API REST |
| On-Premises API | Enterprise legada | Evitar em projeto novo |

### Definições iniciais

| Item | Valor |
|---|---|
| WABA | WhatsApp Business Account criado no portal da Meta |
| Número | Dedicado por setor; DNS pré-verificado; nunca reutilizar número atualmente pareado |
| Idioma/template | Templates pré-aprovados para mensagens fora da janela de 24h |
| Janela de atendimento | 24h após a última mensagem do cliente, sem custo de template |
| Preços | Por conversa (meta por categoria) — validar precificação com a gestão |

### Arquitetura proposta (compatível com o código atual)

- Nova entidade interna **CloudApiConnector** (espelho do `WhatsAppManager`):
  - `send(numberId, phone, text)` → POST graph.facebook.com/vXX/{phone_number_id}/messages
  - Webhook `/api/integrations/whatsapp-cloud/webhook` → mesmo fluxo do `#ingestMessage` (Contact/Conversation/Message + SSE)
- Tabela `WhatsAppNumber` recebe campos `provider = "BAILEYS" | "CLOUD_API"` + credenciais criptografadas (palavra-chave `_`),
 e o inbox e o barramento SSE **não mudam**.
- Credenciais: App ID/Secret + token de sistema em variáveis de ambiente (nunca no banco em texto puro).

### Checklist da fase

- [ ] Conta Meta Business + WABA (WhatsApp Business Account) verificada.
- [ ] App criado e webhook validado (desafio de verificação).
- [ ] Números cadastrados na WABA; limite de conversas aprovado.
- [ ] Conector implementado + feature flag por número.
- [ ] Template "atendimento humano iniciado" aprovado pela Meta.
- [ ] Teste completo do fluxo do Inbox por Cloud API (receber, responder, encerrar).

## Fase 5 — Outros canais

O modelo já separa **canal** (número/conexão) de **conversa/mensagem**, assim:

| Canal | Como entrar |
|---|---|
| **Telegram** | Bot oficial (token), endpoints de update — conector próprio gravando nas mesmas tabelas |
| **Instagram Direct** | Messaging via Meta (mesma Cloud API do Instagram Business) |
| **Webchat (site)** | Widget HTML/JS open-source; nova conversa entra como contato "Webchat:nome" |
| **E-mail** | IMAP/SMTP polling (baixa prioridade) |

Requisitos de arquitetura a respeitar:

1. Todo canal novo deve emitir os mesmos eventos do barramento SSE.
2. `Contact`辨识 unicasession: adicionar campo único por canal (ex.: `telegram_id`) com migração, mantendo o `phone`.
3. Templates de texto do canal não devem vazar para o inbox (normalizar no conector).

## Fase 6 — Escala

- **Redis**: pub/sub dos eventos SSE (permite várias instâncias Next) + cache de queries do inbox.
- **Worker separado para Baileys**: processamento Node próprio (o Next só fala com ele por fila/HTTP) — melhora resiliência das sessões.
- **MySQL** (ver roteiro em `docs/03`).
- Observabilidade: OpenTelemetry + Grafana/Loki (logs estruturados pino).
- Fila de mensagens com retry (BullMQ) para envios.
