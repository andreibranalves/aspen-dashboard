---
date: 2026-04-30
topic: quotation-draft-review
---

# Quotation Draft Review Requirements

## Summary

Add a mandatory draft-review stage between extraction and quotation creation. Every generated order must stop in an editable draft where the operator can fix items, SKUs, quantities, and commercial terms, and can also use a prompt box that proposes changes for approval instead of applying them silently.

---

## Problem Frame

Today the app moves too quickly from extracted order data to an ERPNext quotation. When the extraction is wrong, the operator discovers the mistake only after the quote already exists and usually has to fix it directly in ERPNext. That makes the app feel risky even when the extraction is mostly correct, because a single wrong SKU or quantity turns into rework in a different tool.

The trust problem is not only "did the model understand the request?" but also "can I safely correct it before it becomes a real quote?" The current experience offers almost no intermediate control surface, which pushes the operator to either trust the system blindly or fall back to ERPNext for manual correction.

---

## Actors

- A1. Sales operator: reviews extracted orders, corrects mistakes, and approves draft quotes before creation.
- A2. Orcamento App: extracts order intent, presents draft quotes, proposes prompt-driven edits, and creates the approved quotation.
- A3. ERP quotation system: receives the final approved draft and stores the created quotation.

---

## Key Flows

- F1. Review and correct an extracted draft before creation
  - **Trigger:** The operator submits source text or image and extraction succeeds.
  - **Actors:** A1, A2
  - **Steps:** The app presents each extracted order as a draft; the operator reviews the draft; the operator edits items/SKUs, quantities, and allowed commercial fields as needed; the operator confirms the draft is ready.
  - **Outcome:** The operator has an approved draft that reflects the intended quote before any quotation is created.
  - **Covered by:** R1, R2, R3, R4, R5, R8

- F2. Propose changes through the prompt box
  - **Trigger:** The operator enters a natural-language edit request while reviewing a draft.
  - **Actors:** A1, A2
  - **Steps:** The operator types a requested change; the app interprets it into draft changes; the app shows the proposed result before applying it; the operator accepts or rejects the proposal.
  - **Outcome:** Prompt-driven edits help the operator move faster without silently mutating the draft.
  - **Covered by:** R6, R7, R9

- F3. Create the quotation from an approved draft
  - **Trigger:** The operator approves a reviewed draft.
  - **Actors:** A1, A2, A3
  - **Steps:** The operator confirms creation; the app creates the quotation from the approved draft; the created result is shown back to the operator.
  - **Outcome:** The final quotation reflects the operator-reviewed draft instead of raw extraction output.
  - **Covered by:** R10, R11

---

## Requirements

**Draft review stage**
- R1. The app must insert a mandatory draft-review step between successful extraction and quotation creation.
- R2. Every extracted order must appear as its own editable draft during review.
- R3. The primary job of the review surface must be correcting quoted items and SKU choices before quote creation.
- R4. The review surface must let the operator add items, remove items, change quantities, and change quoted SKU/options.
- R5. The review surface must let the operator adjust prices or discounts before quote creation.

**Prompt-assisted editing**
- R6. Version 1 must include a natural-language prompt box inside the review step for draft edits.
- R7. Prompt-based edits must never apply silently; the app must show the proposed draft changes and require operator approval before they take effect.
- R8. Structured editing and prompt editing must work on the same draft state so the operator can mix both methods in one review session.

**Trust and visibility**
- R9. The review experience must make it clear what changed when a prompt edit is proposed or when the operator edits the draft directly.
- R10. The quotation created by the app must come from the final approved draft, not from the original raw extraction result.
- R11. After creation, the app must return the operator to a result state that clearly reflects the approved draft they reviewed.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4.** Given extraction returns an order with the wrong quoted SKU, when the operator reaches the draft-review step, the order appears as an editable draft and the operator can swap the SKU before any quotation is created.
- AE2. **Covers R5, R10.** Given the operator needs to add a discount before sending the quote, when they adjust the draft pricing and approve creation, the created quotation reflects the reviewed discounted draft rather than the original extracted values.
- AE3. **Covers R6, R7, R8, R9.** Given the operator types “remove the viscose cangas and add ecobags” into the prompt box, when the app interprets the request, it shows the proposed changed draft first, and only applies the changes if the operator approves them.
- AE4. **Covers R10, R11.** Given the operator made both direct edits and prompt-assisted edits in the same review session, when they create the quote, the returned result reflects the final approved draft rather than an earlier intermediate version.

---

## Success Criteria

- Operators can correct the common “wrong item/SKU” class of mistakes without opening ERPNext.
- The review step becomes the normal path for approving quotes, not an optional debug mode.
- Prompt-assisted editing speeds up corrections without reducing operator control.
- A planner can take this doc forward without inventing the main user flow, the edit surface scope, or the prompt approval behavior.

---

## Scope Boundaries

- This version does not make review optional; every extracted order stops in draft review first.
- This version does not expose raw model chain-of-thought as a primary trust feature.
- This version does not define how confidence scoring, evidence panels, or returning-customer memory should work unless they become necessary in a later iteration.
- This version does not include a separate post-creation amendment workflow; the focus is pre-creation draft review.
- This version does not attempt to solve every ERPNext editing need inside the app beyond the specified draft review scope.

---

## Key Decisions

- Mandatory review instead of risk-only review: the product goal is to remove the need to fix common mistakes in ERPNext, so every quote must pass through the draft step.
- Item/SKU correction is the primary job: the biggest trust break comes from quoting the wrong thing, not only the wrong price.
- Prompt editing is included in version 1: it was explicitly requested and is valuable enough to be part of the first release.
- Prompt edits are proposal-based, not auto-applied: this preserves operator trust and avoids replacing one black box with another.

---

## Dependencies / Assumptions

- The quotation flow can be paused safely after extraction and before quote creation without harming the existing operator workflow.
- The draft state can support both direct edits and prompt-proposed edits in one review session.
- Operators are willing to trade a small amount of speed for higher pre-send control and less ERPNext rework.
