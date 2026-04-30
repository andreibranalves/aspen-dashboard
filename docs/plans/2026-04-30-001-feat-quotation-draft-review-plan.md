---
title: "feat: Add Mandatory Draft-Review Stage Between Extraction and Quotation Creation"
type: feat
status: active
date: 2026-04-30
origin: docs/brainstorms/2026-04-30-quotation-draft-review-requirements.md
---

# feat: Add Mandatory Draft-Review Stage Between Extraction and Quotation Creation

## Summary

Insert a mandatory, client-side editing surface between extraction and quotation creation. The existing single-page app gains a per-order draft stage where the operator corrects items/SKUs/quantities/prices before any ERPNext write, and a prompt box allows natural-language corrections that return patch previews for approval. Pricing logic moves to a shared module so live rates are visible during editing.

---

## Problem Frame

The current pipeline moves too quickly from extracted orders to ERPNext quotations. When extraction is wrong, the operator discovers mistakes only after the quote exists and must fix them in ERPNext directly. This erodes trust and creates rework. The new draft stage intervenes at the exact point where correction is cheapest — after extraction, before creation — so the operator controls what gets quoted rather than auditing after the fact.

---

## Requirements

- R1. Insert a mandatory draft-review step between successful extraction and quotation creation.
- R2. Every extracted order must appear as its own editable draft during review.
- R3. The primary job of the review surface is correcting quoted items and SKU choices before quote creation.
- R4. The review surface must let the operator add items, remove items, change quantities, and change quoted SKU/options.
- R5. The review surface must let the operator adjust prices or discounts before quote creation.
- R6. Version 1 must include a natural-language prompt box inside the review step for draft edits.
- R7. Prompt-based edits must never apply silently; show the proposed changes and require operator approval.
- R8. Structured editing and prompt editing must work on the same draft state within one review session.
- R9. The review experience must make it clear what changed when a prompt edit is proposed or when the operator edits the draft directly.
- R10. The quotation created by the app must come from the final approved draft, not from the original raw extraction result.
- R11. After creation, the app must return the operator to a result state that clearly reflects the approved draft they reviewed.

**Origin actors:** A1 (Sales operator), A2 (Orcamento App), A3 (ERP quotation system)
**Origin flows:** F1 (Review and correct an extracted draft before creation), F2 (Propose changes through the prompt box), F3 (Create the quotation from an approved draft)
**Origin acceptance examples:** AE1 (covers R1, R2, R3, R4), AE2 (covers R5, R10), AE3 (covers R6, R7, R8, R9), AE4 (covers R10, R11)

---

## Scope Boundaries

- Review is mandatory — every extracted order stops in draft review before creation.
- Drafts are client-side (in-memory + optional localStorage recovery for the session). No server-side draft persistence.
- Customer name, email, phone, and urgency are editable during review (common extraction error sources).
- A "skip/discard" button exists per draft so junk orders can be removed before creation.
- Empty items after removal triggers a warning at approval time; a create attempt with zero items fails gracefully.
- Pricing is visible during editing via a shared pricing module reused by both the review UI and `orcamento.js`.
- The prompt box is per-order (one per draft card) to avoid scoping ambiguity.
- Approval is per-order with sequential creation calls, matching the existing loop.
- Creation failure shows a retry path that reuses the frozen approved draft state.

### Deferred to Follow-Up Work

- Confidence scoring, evidence panels, and returning-customer memory: future iterations.
- Server-side draft persistence and multi-session recovery: future iteration.
- Full undo/redo history within a single session: not in v1.
- Post-creation amendment workflow: separate feature.

---

## Context & Research

### Relevant Code and Patterns

- `public/index.html` lines 960–1036 — form submit handler; the insertion point for the review stage is between card rendering (line 1007) and the creation loop (line 1014). The `orders` array is local to the submit handler closure.
- `public/index.html` lines 682–690 — localStorage settings pattern (`aspen_rules`, `aspen_wa_template`) that can be reused for draft snapshot persistence.
- `public/index.html` lines 860–880 (`createCard`), 891–945 (`setCardDone`), 947–958 (`setCardError`) — existing card lifecycle that the draft review stage can extend with an intermediate `setCardDraft` state.
- `netlify/functions/orcamento.js` lines 134–142 (`getRate`) — pricing resolution currently only callable during creation; must be extracted to a shared module.
- `netlify/functions/orcamento.js` line 136 — `if (!item.rate)` guard that already skips pricing when a rate is pre-set, enabling draft pricing overrides.
- `netlify/functions/extract.js` — existing natural-language to structured orders pipeline; reusable as the prompt-interpretation endpoint.
- `fast-json-patch` — zero-dependency RFC 6902 library chosen for patch validation and apply on a Netlify Functions cold-start profile.
- `server.mjs` — local dev server; must proxy the prompt endpoint for local testing.

### Institutional Learnings

- The existing `print_html` post-processing pattern (`orcamento.js` lines 282–300, `view.js`) demonstrates regex-based text manipulation in rendered output — a precedent for manipulating data between pipeline stages.
- The `test_local.mjs` harness runs full pipeline tests against real ERPNext; can be extended with a draft-review scenario covering structured edits, prompt edits, and approval.

### External References

- JSON Whisperer (EMNLP 2025): EASE pattern for stable-key array encoding; structured output enforcement reduces LLM patch errors significantly.
- `fast-json-patch` library (npm): `validate()`, `applyPatch()`, and `compare()` for RFC 6902 patch operations.
- Prompt engineering for JSON Patch: enforce structured output (`response_format: json_schema`), restrict operations to `add`/`remove`/`replace`, and enforce highest-to-lowest array index ordering.

---

## Key Technical Decisions

- Pricing logic extraction: `getRate()` moves to a shared module `pricing.js` imported by both `orcamento.js` and the review UI, enabling live rate display without a new API endpoint.
- Draft state model: exclusively client-side in v1. The approved draft is frozen at approval time into a snapshot object used for creation and retry.
- Prompt interpretation: reuses the existing `/api/extract` endpoint with the current draft as context, generating structured orders which are diffed against the live draft via `fast-json-patch.compare()`.
- Per-order approval: matches the existing sequential `for` loop in the form handler; each order reviews, approves, and creates independently.
- localStorage recovery: the full draft array is persisted on each significant edit and restored on page load or refresh, providing session-scoped recovery without server-side storage.

---

## Open Questions

### Resolved During Planning

- Pricing visibility during review: resolved — show prices via shared `pricing.js` module, computed client-side from the ERPNext item catalog.
- Prompt box scope: resolved — per-order prompt box on each draft card.
- Customer field editability: resolved — name, email, phone, and urgency toggle are editable during review.
- Discount semantics: resolved — per-item percentage discount and per-order flat discount, applied as rate overrides in the draft.
- Empty draft handling: resolved — warning at approval time, graceful failure during creation attempt.

### Deferred to Implementation

- Exact SKU catalog lookup mechanism for the draft UI autocomplete: deferred to implementation based on available ERPNext Item data.
- Prompt model temperature and retry policy for patch generation: deferred to implementation tuning.
- localStorage snapshot debounce interval and size limit: deferred to implementation based on observed draft complexity.
- Exact error message wording and toast UI for validation failures: deferred to implementation.

---

## Implementation Units

- U1. **Extract pricing logic to shared module**

**Goal:** Make `getRate()` accessible from both `orcamento.js` (server-side creation) and the frontend review UI, so pricing is visible during draft editing without a new API endpoint.

**Requirements:** R3, R5, R10

**Dependencies:** None

**Files:**
- Create: `netlify/functions/pricing.js` — exports `getRate(itemCode, qty, urgente)`
- Modify: `netlify/functions/orcamento.js` — import `getRate` from `./pricing.js`, remove inline function
- Modify: `public/index.html` — import or inline the pricing logic for client-side rate display (via a script include or data attribute pre-load)
- Test: `test_local.mjs` — verify pricing module returns expected rates for known SKUs

**Approach:**
- Extract the tiered lookup (`Pricing Rule` title = `{SKU}-{bracket}` → `{SKU}` → `Item Price` fallback) from `orcamento.js` into a standalone function.
- Export as ES module so both the Netlify Function (Node.js ESM) and the frontend (via a pre-baked JSON pricing cache served at page load) can resolve rates.
- The existing guard `if (!item.rate)` in `orcamento.js` is preserved — draft-approved rates pass through unchanged.

**Execution note:** Implement the shared module test-first against known ERPNext catalog data.

**Patterns to follow:**
- `netlify/functions/orcamento.js` lines 49–84 (current `getRate` implementation)
- `netlify/functions/orcamento.js` line 136 (existing `if (!item.rate)` guard)

**Test scenarios:**
- Happy path: `getRate('LNC-SED-70', 100)` returns the tiered rule rate for the 100 bracket.
- Happy path: `getRate('ECO-30', 300)` returns the tiered rule rate for the 300 bracket.
- Happy path: `getRate('LNC-SED-70', 100, true)` applies +30% urgency markup.
- Edge case: unknown SKU falls back to `Item Price` in Standard Selling price list.
- Edge case: `qty` is exactly a bracket boundary (30, 100, 300, 500, 1000) — returns the correct bracket rate.
- Edge case: `qty` is 0 or negative — returns the fallback rate or signals unavailable.
- Error path: `getRate` is called without a valid `ERPNEXT_TOKEN` — surfaces a clear error.

**Verification:**
- `node test_local.mjs` passes with the shared `pricing.js` module.
- `orcamento.js` still produces correct rates for existing test scenarios after the migration.
- Frontend can resolve rates for a sample draft array using the pricing module.

---

- U2. **Insert draft review stage into the frontend form handler**

**Goal:** Pause the pipeline after extraction and before quotation creation. Render each extracted order as an editable draft card where the operator can modify items, quantities, SKUs, and pricing before approving creation.

**Requirements:** R1, R2, R3, R4, R5, R8, R10

**Dependencies:** U1

**Files:**
- Modify: `public/index.html` — add `renderDraftCards(orders)` function, draft editing UI (item tables with inline edit controls), approve/skip buttons, and the state management to hold `approvedDrafts`.
- Modify: `public/index.html` — restructure the form submit handler (lines 1001–1033) so that after extraction, the loop pauses and waits for operator approval per order.

**Approach:**
- After `queueEl.innerHTML = ''` (line 1003), instead of proceeding directly to the creation `for` loop, call a new `renderDraftCards(orders)` function.
- Each draft card shows: customer fields (name, email, phone, urgency toggle) and an editable items table with columns for SKU (text input with optional autocomplete), quantity, and rate (editable, initially computed via U1).
- Add two buttons per card: "Aprovar e criar" and "Descartar". The "Aprovar" button freezes the draft into an `approvedDrafts` array entry; the "Descartar" button removes it from the set.
- Once all drafts are approved or discarded, trigger the existing creation loop using the approved drafts.
- After creation, `setCardDone` reflects the approved draft values, not the raw extraction.

**Execution note:** Build the draft card UI first without pricing or prompt box; add those in later units. Validate the approval → creation handoff with one order before scaling to multi-order batches.

**Technical design:** Directional guidance — the draft state lives in a `drafts[]` array that mirrors `orders[]` but with mutable fields.
```
// Conceptual shape of a draft entry (not implementation spec):
{
  original: { nome, email, telefone, urgente, items },
  edited:  { nome, email, telefone, urgente, items },
  approved: false,
  discarded: false
}
```

**Patterns to follow:**
- `public/index.html` — `createCard()` (line 860) for card DOM structure
- `public/index.html` — `setCardDone()` (line 924) for items table rendering
- `public/index.html` — `loadRules()` / `saveRules()` (line 682–690) for localStorage pattern

**Test scenarios:**
- Covers AE1. Happy path: extraction returns an order with wrong SKU; operator opens the draft card, swaps the SKU in the inline editor, and approves. The created quotation reflects the corrected SKU.
- Happy path: extraction returns 3 orders; operator reviews all 3, edits quantities on order 2, discards order 3, and creates orders 1 and 2.
- Covers AE2. Happy path: operator adds a 10% discount to a line item, approves, and the created quotation reflects the discounted price.
- Happy path: operator changes customer email during review; the created quotation links to the correct (potentially different) CRM Contact.
- Edge case: operator removes all items from a draft and tries to approve — warning appears, creation is blocked.
- Edge case: browser refresh during review — drafts reload from localStorage snapshot if available.
- Error path: `/api/orcamento` call fails after approval — the app shows a retry button that reuses the frozen approved draft, not the potentially re-edited draft.
- Integration: operator approves one order (it creates), then realizes a mistake on the next order — the first order's existing ERPNext quotation is untouched by subsequent draft state changes.

**Verification:**
- Existing `test_local.mjs` scenarios still pass (the pipeline works end-to-end).
- Manual test: submit "100 lenços" → draft shows editable card → operator changes quantity to 200 → creates → quotation has 200 units.
- Manual test: submit extraction → draft card → operator swaps SKU → approve → created quotation has the new SKU.

---

- U3. **Add prompt-driven draft editing per order**

**Goal:** Add a per-order prompt box that accepts natural-language edit requests, sends them to the extract endpoint with the current draft as context, and returns proposed changes as a diff preview the operator accepts or rejects.

**Requirements:** R6, R7, R8, R9

**Dependencies:** U2

**Files:**
- Create: `netlify/functions/edit-draft.js` — or modify `extract.js` to accept a draft context parameter and a prompt instruction
- Modify: `public/index.html` — add prompt input, "Propor mudanças" button, and diff preview overlay per draft card

**Approach:**
- Each draft card includes a small text input (the prompt box) and a "Propor mudanças" button.
- On submit, the frontend sends `{ prompt, currentDraft }` to a new or extended endpoint. The endpoint uses the draft as context for the AI model and returns a structured edit proposal (a proposed draft or a JSON Patch array).
- The frontend diffs `currentDraft` against the proposed result using `diffPreview()` logic (a simple field-by-field comparison or a structured side-by-side view).
- The preview shows added, removed, and modified items with inline highlighting. A "Aplicar" button merges the proposal; a "Rejeitar" button discards it.
- The prompt box reuses the existing extraction infrastructure — same AI model, same API key, system prompt extended with draft-editing instructions.

**Execution note:** Start with a minimal prompt endpoint that returns full proposed drafts; add JSON Patch-based diffing in a follow-up refinement if the full-regeneration approach works reliably enough for v1.

**Patterns to follow:**
- `netlify/functions/extract.js` — `extractWithOpenRouter()` function for AI call pattern
- `public/index.html` — `setCardProcessing()` / `setCardDone()` for showing processing and result states

**Test scenarios:**
- Covers AE3. Happy path: operator types "remova as cangas e adicione ecobags" → preview shows removed canga items and added ecobag items → operator clicks "Aplicar" → draft reflects the changes.
- Happy path: operator types "aumente a quantidade do LNC-SED-70 para 200" → preview shows the quantity change → operator approves → draft quantity is 200.
- Happy path: operator rejects a proposed change → draft returns to the pre-proposal state unchanged.
- Edge case: prompt text is empty or only whitespace → no proposal is generated; operator sees a "digite um comando" hint.
- Edge case: prompt model returns a proposal for a field the operator already edited manually → the preview shows the conflict; operator reviews and either accepts (overwrites manual edit) or rejects (keeps manual edit).
- Error path: prompt model call times out → operator sees an error toast and can retry.
- Error path: prompt model returns a proposal referencing an SKU not in the ERPNext catalog → the preview surfaces the unknown SKU as a warning.
- Integration: operator makes a structured edit (U2), then uses the prompt box to propose additional changes → the prompt operates on the live draft (with the structured edit already applied).

**Verification:**
- Manual test: create a draft, type a prompt, verify preview appears, approve, verify draft updated.
- Manual test: create a draft, make a structured edit, then use prompt box — verify both changes coexist in the final approved draft.
- Integration test: extend `test_local.mjs` with a prompt-edit scenario that validates the prompt → preview → approve flow.

---

- U4. **Add localStorage draft snapshot for session recovery**

**Goal:** Persist the full draft state to localStorage on each significant edit so that browser refresh or accidental tab close does not lose all draft work within a single session.

**Requirements:** R1, R8 (indirect — ensures the editing surface is resilient)

**Dependencies:** U2

**Files:**
- Modify: `public/index.html` — add `saveDrafts()` and `restoreDrafts()` functions, debounced save on draft edits, restore check on page load

**Approach:**
- On every draft edit (field change, item add/remove, approval, discard), debounce-save the current `drafts[]` array to `localStorage` under a new key `aspen_drafts`.
- On page load (before the form submit handler), check if `aspen_drafts` exists and is non-empty. If so, offer to restore the previous draft session or start fresh.
- The restore prompt uses a simple confirmation: "Você tem um rascunho salvo de antes. Deseja retomar ou começar de novo?"
- The snapshot includes a timestamp so stale snapshots (older than session) can be detected and optionally discarded.
- On successful quotation creation, the corresponding draft entry is removed from the snapshot. An empty `drafts[]` clears the snapshot.

**Execution note:** Use the existing localStorage pattern from `loadRules`/`saveRules` (lines 682–690) as the template. Set a practical size limit (e.g., 100KB) and surface a warning if the snapshot exceeds it.

**Patterns to follow:**
- `public/index.html` lines 682–690 — existing localStorage key pattern (`aspen_rules`, `aspen_wa_template`)
- `public/index.html` line 706 — "Salvar" button pattern for explicit save

**Test scenarios:**
- Happy path: operator creates a draft, edits items, refreshes the page → restore prompt appears → operator clicks "retomar" → draft state is restored.
- Happy path: operator creates a draft, approves it, the quotation is created → the draft snapshot no longer contains that order.
- Happy path: operator opens the app after a prior session's drafts were all completed or discarded → no restore prompt; starts fresh.
- Edge case: snapshot is corrupted JSON → error is caught, snapshot is discarded, operator starts fresh without crash.
- Edge case: snapshot exceeds the practical size limit → warning is shown; operator can proceed but older snapshot data may be trimmed.

**Verification:**
- Manual test: create a draft, refresh the page, confirm restore works.
- Manual test: approve all drafts, refresh, confirm no stale restore prompt.

---

- U5. **Handle empty drafts and per-order discard flow**

**Goal:** Allow the operator to discard individual drafts (skip creation) and prevent a draft with zero items from being accidentally created.

**Requirements:** R1, R3 (indirect — ensures the review surface prevents clearly invalid quotes)

**Dependencies:** U2

**Files:**
- Modify: `public/index.html` — add "Descartar" button per draft card, validation logic for zero-item drafts

**Approach:**
- Each draft card has a "Descartar" button next to "Aprovar".
- On discard, the card is removed from the review UI and the corresponding entry is marked `discarded: true` in the drafts array. It is excluded from the creation loop.
- When the operator clicks "Aprovar" on a draft with `items.length === 0`, show an inline warning (e.g., "Este rascunho não tem itens — adicione ao menos um item ou descarte-o") and block the approval.
- An order with items but missing required customer fields (empty name) also triggers a warning at approval time.

**Patterns to follow:**
- `public/index.html` — `setCardError()` (line 947) for error/warning rendering pattern
- `public/index.html` — card lifecycle states (processing, done, error) extended with a "draft" state

**Test scenarios:**
- Happy path: operator discards one of three drafts → only two orders appear in the creation loop.
- Edge case: operator removes all items from a draft → inline warning appears → operator cannot approve until they add at least one item or discard.
- Edge case: operator tries to approve a draft with an empty customer name → warning appears.
- Integration: operator discards all drafts → no creation calls are made, and the form is re-enabled for a new extraction.

**Verification:**
- Manual test: create a draft, remove all items, click approve → warning shown, creation blocked.
- Manual test: create 3 drafts, discard 1, approve 2 → only 2 quotations created.

---

- U6. **Extend test harness with draft-review scenarios**

**Goal:** Add coverage for the draft-review stage in `test_local.mjs` so the regression harness validates the new pipeline behavior.

**Requirements:** R1, R2, R10, R11

**Dependencies:** U1, U2

**Files:**
- Modify: `test_local.mjs` — add test cases covering structured draft edits, prompt-based draft edits, approval handoff, and the zero-item guard

**Approach:**
- Add a new test case that simulates: extract → modify the `orders` array inline (simulating structured draft edits like SKU swap and quantity change) → call `orcamentoHandler` with the modified order → verify the created quotation reflects the edits.
- Add a test case for the edge case: extract with a known SKU → modify to an unknown SKU → verify graceful handling.
- Add a test case for the empty items edge case: call `orcamentoHandler` with `items: []` → verify it fails gracefully with a useful error.
- Add a test case for the pricing override: set a pre-defined `rate` on an item → verify `orcamento.js` skips `getRate()` and uses the provided rate.

**Execution note:** The test harness already imports function handlers directly; no UI test is needed. Focus on verifying the server-side contract changes.

**Patterns to follow:**
- `test_local.mjs` lines 31–44 — existing `pipeline()` function pattern
- `test_local.mjs` — existing assertions on `customer_new`, `print_html`, and `items` fields

**Test scenarios:**
- Happy path: extract "100 lenços" → modify items to use `LNC-SED-70` quantity 200 → create → quotation has 200 units.
- Happy path: extract → set `rate: 12.50` on an item → create → quotation item has `rate: 12.50` (not the tiered rule rate).
- Edge case: extract → set `items: []` → create → expect a clear error indicating the quotation cannot be created with zero items.
- Edge case: extract → change email to a known existing customer email → create → `customer_new: false` (the order links to the existing customer).

**Verification:**
- `node test_local.mjs` passes with all existing and new test cases.
- The test harness includes at least one draft-review-specific assertion for each of: structured edits, pricing override, and empty items guard.

---

## System-Wide Impact

- **Interaction graph:** The form submit handler (`public/index.html` line 960) is restructured from a two-phase pipeline to a three-phase pipeline (extract → review → create). The review phase is a client-side blocking step; no new server routes are required for the core review flow.
- **Error propagation:** Extraction failures and creation failures propagate as before. The review step introduces a new failure mode: creation failure after approval. The plan handles this via a per-order retry button that reuses the frozen approved draft, not the live (potentially re-edited) draft.
- **State lifecycle risks:** Drafts are ephemeral client-side state. A browser refresh without localStorage recovery loses the draft. The localStorage snapshot mitigates this within a single session but does not survive across sessions or devices. This is an accepted v1 tradeoff.
- **API surface parity:** The existing `/api/extract` and `/api/orcamento` endpoints retain their current contracts. A new or extended endpoint handles prompt-based draft edits and returns proposed diffs. The `orcamento.js` function gains the ability to accept pre-resolved rates without modification to its existing callers.
- **Integration coverage:** The pricing module extraction (U1) must be verified end-to-end by running existing test scenarios to confirm no regression. The draft review → creation handoff must be tested with both single and multi-order extraction.
- **Unchanged invariants:** The extraction API contract (`POST /api/extract` → `{ orders }`) is unchanged. The quotation creation API contract (`POST /api/orcamento` → `{ quotation_id, ... }`) is backward-compatible — existing callers work without modification. The `/api/view` endpoint is untouched.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Pricing module extraction breaks existing `orcamento.js` behavior | Re-run full test harness after U1; verify rates match before-migration values |
| Client-side draft edits produce data that `orcamento.js` rejects | Add server-side validation for the draft payload fields; fail early with clear errors |
| Prompt model generates invalid or unsafe edits | Validate all prompt proposals with `fast-json-patch.validate()` before preview; block unknown SKUs |
| localStorage snapshot grows too large for complex drafts | Impose a practical size limit (100KB) and surface a warning if exceeded |
| Browser refresh during draft editing causes frustration | localStorage snapshot restores drafts on page load; operator is offered to resume or start fresh |

---

## Documentation / Operational Notes

- Update `AGENTS.md` Architecture section to reflect the three-phase pipeline (extract → review → create).
- The pricing module (`netlify/functions/pricing.js`) becomes a dependency for `orcamento.js` — document the import path in relevant function headers.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-30-quotation-draft-review-requirements.md](docs/brainstorms/2026-04-30-quotation-draft-review-requirements.md)
- **Ideation document:** [docs/ideation/2026-04-30-quotation-review-editing-ideation.md](docs/ideation/2026-04-30-quotation-review-editing-ideation.md)
- Related code: `public/index.html` (form submit handler), `netlify/functions/orcamento.js` (pricing + creation), `netlify/functions/extract.js` (extraction endpoint)
- Related work: `.sisyphus/notepads/task-1/learnings.md`, `.sisyphus/plans/fix-erpnext-quotation-customer-name-print.md`
- External docs: `fast-json-patch` (npm), JSON Whisperer (EMNLP 2025)
