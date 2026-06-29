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

- The Typebot webhook keeps creating/updating the ERPNext Lead.
- When enabled and not `dry_run`, the webhook also upserts a quote lead in KV.
- The Auto page reads `GET /api/quote-leads?limit=5`.
- Clicking a lead fills the extraction textarea with `Nome`, `E-mail`, `Telefone`, and `Pedido`.
- After quotation creation succeeds, the Auto page marks that quote lead as `converted`.

## Environment variables

- `TYPEBOT_LEAD_WEBHOOK_TOKEN`
- `TYPEBOT_LEAD_CAPTURE_ENABLED=true`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
