# Design - Separação do legacy read no rollback

Status: aprovado pelo usuário.

## Contexto

A suíte final de staging roda com egress Frappe bloqueado por default-deny.

Os testes PostgreSQL passam nesse ambiente.

A leitura de uma cotação legacy depende do deployment rollback-compatible e não pertence ao gate `postgres-write`.

A execução final da suíte falha somente nesse caso, enquanto a execução no deployment rollback passou em `staging-e2e-rollback-id-v3.log`.

## Decisão

Remover o caso de leitura legacy da suíte PostgreSQL staging.

Manter a leitura legacy como gate separado do deployment rollback-compatible, com Frappe somente leitura e autenticação protegida.

Não liberar egress Frappe no staging final.

## Contrato de testes

`tests/quotation-cutover-staging.spec.js` valida somente login, cotação PostgreSQL, PDF, link público, outbox, revisão, edição, limpeza e ausência de egress proibido.

`KNOWN_LEGACY_QUOTATION_ID` não é pré-condição da suíte PostgreSQL staging.

O rollback read valida `KNOWN_POSTGRES_QUOTATION_ID` via PostgreSQL e `KNOWN_LEGACY_QUOTATION_ID` via rota autenticada do deployment rollback.

O comando e as identidades ficam documentados no runbook de rollback.

## Evidência

A evidência protegida `staging-e2e-rollback-id-v3.log` registra uma execução legacy passada no deployment rollback.

A evidência final de staging registra os testes PostgreSQL com egress bloqueado separadamente.

## Escopo

Alterar somente testes, pré-condições, runbook, acceptance report e ledger.

Não alterar handlers, flags Production, banco PostgreSQL ou providers.

## Critérios de aceitação

- A suíte PostgreSQL staging não exige nem executa leitura Frappe.
- O gate rollback legacy permanece explícito e obrigatório antes de declarar rollback compatível.
- A execução rollback legacy continua produzindo evidência protegida sem payload ou segredo no repositório.
- `git diff --check`, testes unitários e as suítes E2E correspondentes passam.
