# Origem durável de orçamento

Este runbook complementa a especificação normativa da issue #186 e depende da entrada de formulário durável entregue em #202. O escopo desta etapa é #203.

## Fonte de verdade

```text
quote_leads.id
    │ quotations.quote_lead_id (histórico direto, imutável)
    ▼
quotations.id ──► quote_revisions.id ──► sales_orders.quotation_revision_id
    └───────────────────────────────► sales_orders.quotation_id
```

`quotations.quote_lead_id` é a autoridade da origem histórica. `quote_leads.quotation_id`, `crm_deals.quotation_id` e o cliente do negócio continuam sendo ponte operacional para o orçamento mais recente e podem mudar quando a mesma submissão gera outro orçamento. Contato, nome e ordem de consulta nunca substituem o vínculo direto.

Uma oportunidade iniciada pelo formulário usa `source = site_form`, exibido como `Formulário do site`. Ausência e incoerência aparecem como `Origem ausente` e `Origem conflitante`; não são corrigidas automaticamente.

## Investigação somente leitura

O relatório abaixo lista todas as associações plausíveis por e-mail ou telefone normalizado dentro da janela. Ele emite somente referências internas, motivos e distância temporal. Não usa nome como prova, não escolhe candidato e não grava nada.

```bash
npm run quotation-origin:candidates -- --from 2026-01-01T00:00:00Z --to 2026-02-01T00:00:00Z --window-days 7 --dry-run
```

Analise `reason`, a quantidade de candidatos por orçamento e a distância temporal. Mesmo um único candidato não autoriza associação histórica. Qualquer correção exige decisão e operação separadas.

## Migração e validação

A migração `0032_quotation_origin.sql` adiciona a coluna anulável com `ON DELETE RESTRICT` e um índice parcial não único. Linhas anteriores permanecem `NULL`.

```bash
npm run check:db-migrations
npm run test:postgres
npm run verify:fast
```

Não há nova configuração operacional. A aplicação de migração em Preview ou Production, backfill e ativação externa não fazem parte desta entrega. Em rollback de aplicação, preserve a coluna e os vínculos já gravados; não remova a coluna nem tente reconstruir a origem por contato.
