# Inbox de Pré-orçamentos

A Inbox de Pré-orçamentos centraliza pedidos antes da criação do orçamento local.

## Fontes

- `typebot`: webhook `/api/typebot-lead-capture`.
- `site_form`: formulário do site via `/api/quote-leads`.
- `whatsapp`: conversas sincronizadas pela Inbox Comercial em `#/whatsapp-inbox`.
- `manual`: reservado para criação manual futura.

## Status

- `new`: recebido, ainda sem ação humana.
- `incomplete`: faltam nome, contato ou pedido.
- `ready`: dados suficientes para extração.
- `reviewing`: operador começou revisão.
- `converted`: orçamento local criado e `quotationId` salvo.
- `discarded`: descartado manualmente.

## Rota do dashboard

Abra `#/pre-orcamentos`.

## Configuração

- `TYPEBOT_LEAD_WEBHOOK_TOKEN`: token do webhook Typebot.
- `TYPEBOT_LEAD_CAPTURE_ENABLED`: habilita captura durável local.
- `DATABASE_URL`: conexão PostgreSQL do ambiente.
- `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_INSTANCE`: transporte WhatsApp opcional.

## Fluxo

1. Receba um pedido por Typebot, site ou WhatsApp.
2. Confirme o item na inbox.
3. Execute a extração e revise o payload.
4. Crie o orçamento PostgreSQL.
5. Acompanhe o status local do lead e do CRM.

O fluxo não acessa dados externos de CRM e não envia mensagens sem uma ação explícita do operador.
