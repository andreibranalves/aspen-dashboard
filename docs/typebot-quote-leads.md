# Typebot Quote Leads

The Auto page lead queue is fed by structured Typebot submissions, not by guessing names from raw WhatsApp history.

## Typebot trigger

Recommended trigger phrases:

- orçamento
- quero orçamento
- cotação
- quero cotação

## Required webhook

Typebot posts to `POST /api/typebot-lead-capture` with header `Authorization: Bearer TYPEBOT_LEAD_WEBHOOK_TOKEN`.

## Recommended payload

Use this JSON body:

```json
{
  "nome": "Viviane Correa",
  "email": "viviane@example.com",
  "telefone": "(11) 97808-6811",
  "produto": "lenço",
  "quantidade": "100",
  "mensagem_contexto": "Cliente pediu orçamento pelo WhatsApp"
}
```

## Dashboard behavior

- Typebot continues to create/update ERPNext Lead.
- Enabled, non-dry-run Typebot submissions upsert `typebot` pre-quotes in KV.
- Site quote forms can upsert `site_form` pre-quotes through authenticated `POST /api/quote-leads`.
- The inbox at `#/pre-orcamentos` is the primary review queue.
- After quotation creation succeeds, the queue record is marked `converted`.

## Environment variables

- `TYPEBOT_LEAD_WEBHOOK_TOKEN`
- `TYPEBOT_LEAD_CAPTURE_ENABLED=true`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
