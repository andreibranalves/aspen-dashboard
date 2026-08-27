# Resume closure counts fix

> **Documento histórico (não-normativo).** Registro de execução/análise concluída, mantido como evidência; nenhum comando aqui é política executável atual. Fontes normativas: [`AGENTS.md`](../../../AGENTS.md) e [`docs/release-lanes.md`](../../../docs/release-lanes.md).

Updated migration manifests to derive product, pricing, client, and quotation exclusion counts from the validated discard plan.

Historical document counts remain report-derived.

Added a regression covering an apply whose first attempt fails during lease release after all checkpoints are completed.

The resumed apply has zero current-attempt counts for most excluded entities while preserving exact discard-plan closure counts.

Validation completed with focused migration tests.

No source, staging, or database writes were performed.
