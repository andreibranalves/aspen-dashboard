# Fechamento da Migração e Cutover Design

**Status:** aprovado pelo usuário em 2026-08-08.

## Objetivo

Concluir a migração gradual de Frappe/ERPNext para PostgreSQL como CRM interno.

A entrega final precisa estar pronta para merge, staging e cutover de produção com evidências de backup, restore, canário e rollback.

## Decisões aprovadas

- PostgreSQL será o CRM interno de clientes, leads, cotações, revisões e histórico.
- Frappe/ERPNext continuará apenas como fonte legada durante a migração.
- Nenhum CRM externo será configurado.
- N8N e Evolution não fazem parte do critério de conclusão atual.
- O adapter CRM externo do outbox será opcional.
- Um fake bridge controlado será usado para testar sucesso, retry, timeout, rejeição e idempotência.
- O staging usará snapshot anonimizado representativo do Frappe.
- "100%" significa branch pronta para merge, staging validado e cutover de produção executável.
- `CRM_CORE_QUOTES_ENABLED` continuará sendo o único flag de rollout de orçamentos.
- Rollout de produção permanecerá desligado até todos os gates passarem.

## Arquitetura

```text
Frappe anonimizado -> dry-run/apply -> PostgreSQL interno
PostgreSQL -> revisão imutável -> PDF/link público
PostgreSQL -> outbox interno -> fake bridge de staging
```

A migração histórica usa `ERPNEXT_TOKEN` e grava apenas dados normalizados, lineage e referências canônicas.

O outbox registra eventos internos sem payload bruto, PII ou secrets.

Nenhum caminho PostgreSQL de cotação pode chamar Frappe.

A rota administrativa `/api/view` continua protegida.

Links enviados a clientes usam somente tokens revision-bound do `/api/public-quotation`.

## Gates de conclusão

1. Todos os Critical e Important findings da revisão final estão corrigidos.
2. O schema da branch está aplicado em `TEST_DATABASE_URL` isolado.
3. O snapshot anonimizado foi migrado com manifest, cutoff, lineage e reconciliação aprovados.
4. Playwright passa no staging com egress Frappe bloqueado.
5. O fake bridge comprova outbox, idempotência, retry, timeout e dead-letter.
6. Backup e restore foram executados em destino isolado.
7. Canário de produção e leitura de rollback passaram.
8. `CRM_CORE_QUOTES_ENABLED` só é ativado após aprovação operacional registrada.

## Fora de escopo

- Integração com HubSpot, Zoho, Bigin ou outro CRM SaaS.
- Envio real por N8N ou Evolution.
- Persistência de PDF histórico em Blob nesta fase.
- Remoção imediata de todos os caminhos legados antes de comprovar a migração.
