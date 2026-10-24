# 01 — Visão Geral do Produto

## O problema

Cada setor da empresa cuida do próprio WhatsApp de forma manual: número pessoal, conversas perdidas no celular de um único funcionário, zero histórico, zero visibilidade de gestão. O atendimento externo (clientes) e interno (colaboradores) fica desorganizado.

## A solução

Uma **central de atendimento multicanal**, no espírito do Chatwoot, porém multi-setor e multi-número em uma única aplicação:

- **Cada setor** (Financeiro, RH, Suporte, Comercial...) tem seus próprios números vinculados.
- **Os atendentes** operam um inbox unificado em tempo real no navegador.
- **A gestão** enxerga indicadores e o histórico completo de conversas.
- **Suporte interno e externo** se diferenciam apenas por número/setor.

## Personas

| Persona | O que faz | Perfil no sistema |
|---|---|---|
| Administrador | Cadastra setores, números, usuários; acompanha o dashboard | `ADMIN` |
| Atendente | Atende conversas no inbox, responde, encerra | `AGENT` |
| Supervisão (futura) | Gestão de fila/atribuição entre atendentes | reservado no modelo de vínculos |
| Contato | Pessoa que fala no WhatsApp da empresa | tabela `Contact` |

## Modelo multicanal (estratégia em fases)

| Fase | Canal | Situação |
|---|---|---|
| 1 (atual) | WhatsApp **não-oficial** (Baileys, pareamento por QR) | Em operação |
| 2 | **WhatsApp Business / Cloud API da Meta** (canal oficial) | Planejada — arquitetura já isola o canal |
| 3 | Instagram Direct, Telegram, Webchat, webhooks externos | Aberta — modelo de dados e barramento SSE são agnósticos de canal |

> TODO: definir política com jurídico/compliance sobre uso de canal não-oficial. O WhatsApp exige **número dedicado** (não pode ter conta em outro app/pareamento ativo) — ver `docs/07`.

## Princípios de produto

1. **Um só lugar**: toda conversa tem histórico, status e responsável.
2. **Multi-setor**: setores não dividem inbox — a rota é número ↔ setor ↔ atendente.
3. **Simplicidade de operação**: conectar número pelo painel, 3 cliques + QR.
4. **Evolução sem retrabalho**: trocar de canal ou banco não muda o inbox.
5. **Segurança desde o início**: sessão httpOnly, senhas com bcrypt, `.env` fora do git.

## Fluxo de atendimento (v0.1)

```
Contato manda mensagem no WhatsApp do setor
        │
        ▼
Baileys recebe (messages.upsert)
        │
        ▼
Gerenciador grava Contact + Conversation(PENDING) + Message
        │
        ▼
Barramento emite eventos SSE ──► Inbox atualiza em tempo real
        │
        ▼
Atendente clica "Iniciar atendimento" (status OPEN + atribuição automática)
        │
        ▼
Diálogo em tempo real, responde pelo painel
        │
        ▼
"Encerrar conversa" (status CLOSED).
Mensagem nova em conversa encerrada reabre como PENDING.
```

## O que fica de fora do v0.1 (ver roadmap)

Grupos, mídia (imagem/áudio/documento), respostas rápidas, tags/etiquetas, transferência entre setores, notificações, relatórios avançados, automações/bot.
