# Resume closure counts fix

Updated migration manifests to derive product, pricing, client, and quotation exclusion counts from the validated discard plan.

Historical document counts remain report-derived.

Added a regression covering an apply whose first attempt fails during lease release after all checkpoints are completed.

The resumed apply has zero current-attempt counts for most excluded entities while preserving exact discard-plan closure counts.

Validation completed with focused migration tests.

No source, staging, or database writes were performed.
