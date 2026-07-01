# Inbox de Pré-orçamentos

A Inbox de Pré-orçamentos centraliza pedidos antes da criação do orçamento no ERPNext.

## Fontes

- `typebot`: webhook `/api/typebot-lead-capture`.
- `site_form`: formulário do `aspen-site` via `/api/quote` e POST autenticado para `/api/quote-leads`.
- `whatsapp`: conversas sincronizadas pela Inbox Comercial em `#/whatsapp-inbox`.
- `manual`: reservado para criação manual futura.

## Status

- `new`: recebido, ainda sem ação humana.
- `incomplete`: faltam nome, contato ou pedido.
- `ready`: dados suficientes para extração.
- `reviewing`: operador começou revisão.
- `converted`: orçamento criado e `quotationId` salvo.
- `discarded`: descartado manualmente.

## Rota do dashboard

Abra `#/pre-orcamentos`.

## Variáveis de ambiente

Dashboard:

- `QUOTE_LEADS_INGEST_TOKEN`: token Bearer para ingestão externa.
- `KV_REST_API_URL` e `KV_REST_API_TOKEN`: Vercel KV.
- `TYPEBOT_LEAD_WEBHOOK_TOKEN`: webhook Typebot.
- `TYPEBOT_LEAD_CAPTURE_ENABLED=true`: habilita escrita real.

Site:

- `QUOTE_LEADS_INGEST_TOKEN`: mesmo valor do dashboard.
- `ASPEN_DASHBOARD_URL`: padrão `https://dashboard.aspenestamparia.com`.

## Evolution / Typebot

O fluxo recomendado é ter apenas um dono do início do Typebot:

1. `/api/evolution-webhook` recebe `MESSAGES_UPSERT`.
2. Resolve `[ref:token]` em Supabase `attribution_tokens`.
3. Chama Evolution `/typebot/start` com variáveis preenchidas.
4. O Typebot envia dados para `/api/typebot-lead-capture`.

Evite manter o keyword trigger nativo da Evolution ativo ao mesmo tempo para o mesmo texto, pois isso pode duplicar sessões.

## Rollout

1. Confirmar que `/api/quote-leads` GET/PATCH/POST funciona em produção.
2. Confirmar que `captura-lead-aspen` não inicia duplicado.
3. Enviar um formulário real do site e verificar item `site_form` na inbox.
4. Enviar um WhatsApp real com `[ref:token]` e verificar item `typebot` com attribution.
5. Gerar um orçamento pela inbox e confirmar status `converted` com `quotationId`.

## WhatsApp Inbox

A Inbox Comercial de WhatsApp fica em `#/whatsapp-inbox`.

Fluxo recomendado:

1. Clique em `Sincronizar` para buscar conversas recentes da Evolution API.
2. Abra uma conversa e confira o painel comercial.
3. Clique em `Extrair orçamento` quando a conversa tiver pedido em texto livre.
4. Revise o payload extraído.
5. Clique em `Criar pré-orçamento` para enviar a conversa para `#/pre-orcamentos`.
6. Continue o fluxo existente para revisar e gerar o orçamento.

O MVP não substitui o WhatsApp Web e não responde mensagens pelo dashboard.
