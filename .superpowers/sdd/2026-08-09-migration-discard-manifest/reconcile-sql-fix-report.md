# Reconciliation SQL fix

> **Documento histórico (não-normativo).** Registro de execução/análise concluída, mantido como evidência; nenhum comando aqui é política executável atual. Fontes normativas: [`AGENTS.md`](../../../AGENTS.md) e [`docs/release-lanes.md`](../../../docs/release-lanes.md).

Qualified every revision projection column against `quote_revisions r` in the joined target query.

Added `ON_ERROR_STOP=1` to every reconciliation `psql` invocation so SQL errors fail closed instead of becoming empty JSON projections.

Added seam regressions for safe PostgreSQL errors, `ON_ERROR_STOP` arguments, qualified revision SQL, and non-empty revision, item, and template projections.

Focused reconciliation tests passed.

No source, staging, or database writes were performed.
