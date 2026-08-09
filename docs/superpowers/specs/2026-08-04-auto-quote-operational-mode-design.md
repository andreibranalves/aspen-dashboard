# Auto Quote no Modo Operacional

**Data:** 2026-08-04

## Decisão

A tela `/auto` permanece disponível no modo operacional.

Ela mantém a extração por IA e grava o orçamento no CRM PostgreSQL interno.

O Frappe não participa do fluxo quando `CRM_OPERATIONAL_MODE=true`.

## Fluxo

1. `POST /api/extract` envia texto ou imagem ao OpenRouter.
2. `POST /api/pricing-lookup` resolve preços no catálogo PostgreSQL.
3. `POST /api/orcamento` grava cliente, itens, template, revisão e outbox no PostgreSQL.
4. `GET /api/quotations` e `GET /api/quotation-templates` usam os repositórios PostgreSQL.
5. `GET/PATCH /api/quote-leads` usa o armazenamento próprio de leads.

## Rollout

`CRM_OPERATIONAL_MODE=true` força o domínio de orçamentos para `postgres-write`.

A rota `/auto` fica fora da lista de rotas ocultas e aparece na navegação operacional.

O modo operacional continua ocultando telas e handlers que ainda dependem de Frappe ou de provedores externos não migrados.

## Segurança

A extração valida a entrada e exige `OPENROUTER_API_KEY` no runtime.

O core PostgreSQL não faz fallback silencioso para Frappe quando falha.

As flags permanecem desligadas por padrão no `.env.example`.

## Cobertura

Os testes verificam que o modo operacional expõe `/auto`, mantém a rota sem redirecionamento e percorre extração, precificação e criação de orçamento com respostas PostgreSQL.
