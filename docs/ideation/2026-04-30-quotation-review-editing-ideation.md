---
date: 2026-04-30
topic: quotation-review-editing
focus: improve trust and editability in the Orcamento App quotation flow when extracted orders differ from user expectation
mode: repo-grounded
---

# Ideation: Quotation Review and Editing

## Grounding Context

### Codebase Context
- The strongest leverage point in the repo is the gap between extraction and quotation creation: `orders` already exist in the browser before `/api/orcamento`, but there is no structured review step.
- `public/index.html` currently renders order cards as read-only and then immediately starts quotation creation.
- The app has almost no extraction-quality trust UX today; the only visible badge is `customer_new`, which is a CRM signal, not an extraction-confidence signal.
- The repo already has patterns for local user settings and for post-processing output, which suggests a lightweight review/edit layer would fit the current architecture.

### Past Learnings
- Existing learnings emphasize robust post-processing of quote output and reliable end-to-end verification, but there is no prior trust/review loop for extraction.
- The codebase currently behaves like a fire-and-forget pipeline rather than a human-in-the-loop draft workflow.

### External Context
- External research converged on four stronger trust patterns than raw “thinking mode”: **diff preview**, **evidence/citation panels**, **confidence triage**, and **manual fallback/editing**.
- Natural-language patching of structured data is a strong secondary pattern, but it works best when paired with explicit diff preview and confirmation.

## Ranked Ideas

### 1. Editable Draft Review Step Before Quote Creation
**Description:** Pause after extraction and turn the existing order cards into editable drafts that the user confirms before ERPNext creation. This is the central review loop: the user sees extracted customer/item data, corrects anything wrong, and only then proceeds.
**Warrant:** `direct:` the repo already holds `orders` client-side before `/api/orcamento`, and the current UI renders them as read-only despite that being the natural review hook.
**Rationale:** This is the most grounded fix for the user's stated pain because it intervenes exactly where mistakes can still be corrected without side effects.
**Downsides:** Adds one more step to the happy path and needs careful UX so fast/simple quotes still feel quick.
**Confidence:** 93%
**Complexity:** Medium
**Status:** Explored

### 2. Pre-Flight Diff / Rendered Quote Preview
**Description:** Show what the customer asked for versus what will actually be quoted, including resolved SKUs, prices, totals, and pricing-rule effects.
**Warrant:** `direct:` the main pain is “the quote isn’t what I expected”; `external:` diff/preview is the canonical trust pattern before commit in many domains.
**Rationale:** Makes the hidden transformation from extracted order to resolved quote visible before ERPNext side effects happen.
**Downsides:** Can feel redundant if not tightly integrated with the draft review surface.
**Confidence:** 91%
**Complexity:** Medium
**Status:** Unexplored

### 3. Evidence + Pricing Rationale Panel
**Description:** For each line item, show the source snippet and the pricing-rule path that produced the result.
**Warrant:** `external:` mature AI/document tools use evidence and citations instead of raw chain-of-thought; `direct:` pricing and SKU resolution are currently opaque in this app.
**Rationale:** This is the best replacement for a generic “thinking toggle” because it gives verifiable transparency rather than noisy reasoning text.
**Downsides:** More UI density; must stay collapsible and secondary so it does not overwhelm the main review flow.
**Confidence:** 89%
**Complexity:** Medium
**Status:** Unexplored

### 4. Confidence Triage With Ambiguity Gating
**Description:** Flag uncertain fields/items and require explicit review only where the system is least sure.
**Warrant:** `external:` confidence triage is proven in AI-assisted workflows; `direct:` the current app gives no extraction-quality signal at all.
**Rationale:** Adds safety without forcing heavy review for every straightforward order.
**Downsides:** Confidence wording must be careful or users may overtrust the signal.
**Confidence:** 84%
**Complexity:** Medium
**Status:** Unexplored

### 5. Natural-Language Amendment Editor After Generation
**Description:** Let the user fix an already created quote with short commands like “add ecobags” or “increase this SKU by 100,” then preview/apply the diff.
**Warrant:** `direct:` this was explicitly requested by the user and repeatedly surfaced across ideation frames as the strongest recovery path after generation.
**Rationale:** High user value because it gives a graceful correction path when the mistake is noticed only after the quote already exists.
**Downsides:** Needs a strong patch/diff layer so edits stay predictable and safe.
**Confidence:** 87%
**Complexity:** High
**Status:** Unexplored

### 6. Manual Override / Fallback Mode
**Description:** Add Auto/Manual controls for SKU and quantity overrides, plus forced selection when ambiguity is too high.
**Warrant:** `reasoned:` when automation is uncertain, explicit human choice is cheaper than silently generating the wrong quote.
**Rationale:** Provides a reliable escape hatch and complements the main review loop.
**Downsides:** Some users may stay in manual mode too often if the trust loop remains weak.
**Confidence:** 82%
**Complexity:** Medium
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Raw thinking/debug toggle as the main feature | Weaker than evidence/diff/triage; adds noise without giving the user meaningful control. |
| 2 | Standalone multi-hypothesis output | Useful, but largely duplicates the stronger confidence/ambiguity gate and adds more complexity up front. |
| 3 | Audit trail / rollback | Valuable later, but secondary to preventing the wrong quote before it is created. |
| 4 | Returning-customer precedent assistant | Interesting leverage, but less urgent than fixing the core trust loop for every quote. |
| 5 | What-if pricing sandbox | Helpful optimization tool, but narrower than the trust/editability problem being solved here. |
