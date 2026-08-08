# Procedimento de corte operacional

O procedimento executável de corte e rollback de orçamentos está em [`docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`](superpowers/plans/2026-08-05-quotation-cutover-runbook.md).

Este documento permanece como índice operacional curto.

Não use o procedimento antigo que desligava somente `CRM_OPERATIONAL_MODE` e declarava rollback concluído.

Depois de qualquer escrita PostgreSQL, definir uma flag como `false` não restaura dados Frappe e não é rollback suficiente.

## Pré-condições obrigatórias

- backup PostgreSQL criado e validado em destino isolado;
- `npm run build:api` concluído;
- `npm run test:unit` concluído;
- `npm run lint` concluído;
- `npm run type-check` concluído;
- `npm run check:tailwind` concluído;
- `npm run build` concluído;
- dry-run com manifest, hash e divergências revisados;
- dependências aplicadas na ordem templates, produtos, preços, clientes/leads e orçamentos;
- PDFs sob demanda validados com `%PDF-`, `%%EOF`, tamanho e checksum;
- política PDF on-demand registrada, sem retenção de PDF histórico;
- bloqueio de egress Frappe preparado para a fase pós-apply;
- leitura de rollback e teste de segurança de link público aprovados.

## Estados do domínio de orçamentos

| Estado | Leitura | Escrita |
| --- | --- | --- |
| `legacy` | Frappe | Frappe |
| `postgres-write` | PostgreSQL | PostgreSQL e outbox |
| `postgres-read-only` | PostgreSQL | congelada ou comportamento endpoint-específico testado |
| `rollback-compatible` | PostgreSQL com fallback observável para registro legado ausente | Frappe |

A fonte de verdade é `CRM_CORE_QUOTES_ENABLED` combinada com `CRM_QUOTES_ROLLOUT_STATE`.

A flag mestre só pode ser alterada com snapshot, motivo, operador, revisor e horário UTC registrados.

## Fluxo resumido

1. Execute o runbook draft completo em ambiente de staging.
2. Faça backup e restore de validação.
3. Execute dry-run e verifique o manifest sem expor dados brutos.
4. Resolva divergências e órfãos antes do apply.
5. Execute apply uma vez e preserve o run ID.
6. Reconcilie contagens, hashes, status, pedidos, PDFs sob demanda e outbox.
7. Congele chamadas Frappe não previstas e execute o canário.
8. Avance ou entre em `rollback-compatible` conforme as evidências.

## Abort e rollback

Aborte para duplicata, divergência financeira sem explicação, órfão, PDF inválido, chamada Frappe inesperada, lote falho, falha de link público ou falha de leitura de rollback.

No rollback, congele novos efeitos, mantenha `CRM_CORE_QUOTES_ENABLED=true`, defina `CRM_QUOTES_ROLLOUT_STATE=rollback-compatible` e faça redeploy.

Valide registros PostgreSQL e legados antes de qualquer decisão posterior.

Nunca apague o PostgreSQL para simular rollback.
