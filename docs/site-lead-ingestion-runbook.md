# Entrada durável de solicitações do site

## Fluxo e fontes de verdade

```text
formulário
  -> Sanity quoteRequest (submissão durável e estado dos efeitos)
  -> POST /api/site-quote-leads
  -> PostgreSQL quote_leads + crm_deals (uma transação)
```

O Sanity é a fonte de verdade da submissão recebida pelo site. `quote_leads` e `crm_deals` são a fonte operacional do CRM. `external_id` liga o lead ao `_id` do Sanity. O snapshot protegido `quote_leads.raw.siteSubmission` guarda o fingerprint, a data original, a evidência de consentimento recebida e apenas o tipo do identificador publicitário primário. `quote_leads.created_at` continua sendo a data de ingestão.

O formulário não cria orçamento, pedido, follow-up ou comunicação por WhatsApp. Uma falha de e-mail ou Dashboard depois do commit no Sanity não muda o sucesso ao visitante. Os estados `emailNotification` e `dashboardDelivery` permitem identificar a pendência.

## Configuração e rotação

No site, configurar `ASPEN_DASHBOARD_URL`, `QUOTE_LEADS_INGEST_TOKEN`, as variáveis Sanity, Resend e reCAPTCHA já existentes. Não há hostname de Dashboard padrão.

No Dashboard, configurar `QUOTE_LEADS_INGEST_TOKEN`. Para rotação:

1. Definir o segredo novo como `QUOTE_LEADS_INGEST_TOKEN` e manter temporariamente o anterior em `QUOTE_LEADS_INGEST_PREVIOUS_TOKEN`.
2. Trocar o emissor no site para o segredo novo.
3. Confirmar ingestão sintética no alvo aprovado.
4. Remover `QUOTE_LEADS_INGEST_PREVIOUS_TOKEN`. O segredo removido passa a receber `401`.

Os segredos devem ter pelo menos 32 bytes, ficar fora do checkout e nunca usar prefixo `NEXT_PUBLIC_`.

## Reconciliação somente leitura

Executar inicialmente uma conferência diária e também após indisponibilidade do Dashboard. Sempre repetir a partir do último intervalo inteiramente concluído. O intervalo é `[from,to)` e a paginação usa `createdAt, _id`, sem CDN, drafts ou versões.

```bash
npm run leads:reconcile -- \
  --from 2026-09-04T00:00:00-03:00 \
  --to 2026-09-05T00:00:00-03:00 \
  --dry-run
```

O relatório sanitizado do dry-run contém `lidos`, `criaria`, `deduplicaria`, `rejeitados`, `erros` e `conflitos`. Apply usa `criados` e `deduplicados` no lugar das projeções. Dry-run lê Sanity e PostgreSQL, mas não cria leads, oportunidades, checkpoints, auditorias nem estados no Sanity.

## Apply protegido

Apply é uma liberação operacional separada. Antes dele, confirmar que deployment, `APP_ENV`, banco, projeto e dataset Sanity pertencem ao mesmo alvo, revisar o dry-run e definir externamente:

- `LEADS_RECONCILE_APPROVED_TARGET`
- `LEADS_RECONCILE_APPLY_APPROVED=1`
- `LEADS_RECONCILE_DATABASE_FINGERPRINT`, SHA-256 de `hostname|porta|database`, sem credenciais
- `LEADS_RECONCILE_SANITY_PROJECT_ID`
- `LEADS_RECONCILE_SANITY_DATASET`

Então executar com `--target` idêntico a `APP_ENV` e ao alvo aprovado:

```bash
npm run leads:reconcile -- \
  --from 2026-09-04T00:00:00-03:00 \
  --to 2026-09-05T00:00:00-03:00 \
  --apply \
  --target staging
```

Não usar `--apply` em produção sem lista e intervalo aprovados. Uma falha intermediária não cria checkpoint: corrigir a causa e repetir todo o intervalo, pois a ingestão é idempotente. Conflito de fingerprint exige revisão do documento e não autoriza sobrescrever o lead.

## Investigação e rollback

Para investigar, comparar somente referências internas: `_id` Sanity, `quote_leads.external_id`, `quote_leads.id` e `crm_deals.quote_lead_id`. Não inferir por nome, e-mail ou telefone e não imprimir PII ou click IDs.

Rollback desativa a configuração do emissor ou reverte o código, preservando documentos Sanity, leads e oportunidades já gravados. Não apagar histórico. A reconciliação cobre a lacuna depois da correção.

Este código não ativa agendamento, backfill real, deploy, migration, vínculo histórico, WhatsApp, upload ao Google ou mudança de campanha.
