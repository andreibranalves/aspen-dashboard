# Fix ERPNext Quotation Customer Name Print

## TL;DR
> **Summary**: Eliminate `CRM-LEAD-...` from every quotation print path by fixing the repo-side HTML response path and the ERPNext `Aspen 1.0` print format itself.
> **Deliverables**:
> - Lead-safe `print_html` generation in `netlify/functions/orcamento.js`
> - Parity/hardening in `netlify/functions/view.js`
> - Dead frontend print Blob path removed from `public/index.html`
> - `Aspen 1.0` print format updated to render customer display name, not Lead ID
> - Lightweight regression checks added to `test_local.mjs`
> **Effort**: Short
> **Parallel**: YES - 3 waves
> **Critical Path**: Task 1 → Task 2 + Task 5 → Final Verification Wave

## Context
### Original Request
Investigate why clicking print in ERPNext shows `CRM-LEAD-...` as the customer name while the app-rendered/opened quotation can show the real customer name. Final requirement: quotation customer name must always be the real customer name; `CRM Lead` must never appear.

### Interview Summary
- Scope confirmed: fix both the repo (`orcamento-app`) and native ERPNext print behavior.
- Verification strategy confirmed: lightweight only; use existing scripts/HTML checks, no new test framework.
- Desired outcome: all visible quotation entrypoints show the customer name consistently.

### Metis Review (gaps addressed)
- Root cause is divergent render paths, not extraction logic.
- `send-email.js` is missing; exclude it from this plan to avoid scope creep.
- Prefer isolated, low-risk fixes over a new shared helper file.
- Guard strictly on `quotation_to === 'Lead'` so Customer quotations do not regress.
- Add explicit assertions for both absence of `CRM-LEAD` and presence of expected clean names.

## Work Objectives
### Core Objective
Make every quotation render path show the human customer name instead of the Lead ID, with no regression for Customer quotations.

### Deliverables
- `test_local.mjs` extended into a lightweight regression harness covering one Lead quotation path and one Customer quotation path.
- `netlify/functions/orcamento.js` returns cleaned `print_html` for Lead quotations.
- `netlify/functions/view.js` remains consistent with the same display-name precedence and logs/fails clearly if raw Lead IDs survive replacement.
- `public/index.html` no longer constructs unused raw-print Blob URLs.
- ERPNext custom print format `Aspen 1.0` uses `doc.customer_name` for the displayed name field.

### Definition of Done (verifiable conditions with commands)
- `node test_local.mjs` exits `0` and reports both Lead and Customer cases as passing.
- Direct ERPNext print HTML for a Lead quotation no longer contains `CRM-LEAD` in the displayed `Nome:` field.
- `curl -s "http://localhost:8888/api/view?q=<LEAD_QUOTATION_ID>"` contains the clean customer name and does not contain `CRM-LEAD`.
- `curl -s "http://localhost:8888/api/view?q=<CUSTOMER_QUOTATION_ID>"` still contains the correct customer name.
- App UI button `Abrir orçamento →` continues to resolve through `short_url`/`/api/view`, never a raw `print_html` Blob URL.

### Must Have
- Lead-only replacement logic in `orcamento.js` using the same HTML-targeting pattern already proven in `view.js`.
- ERPNext `Aspen 1.0` print format changed at the source so native ERPNext print is correct without relying on app-side post-processing.
- Regression coverage for both Lead and Customer quotation flows.
- Evidence captured under `.sisyphus/evidence/` for every task.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must NOT add Jest/Vitest/Mocha/Playwright setup for this bug.
- Must NOT convert Leads into Customers as part of the fix.
- Must NOT rewrite unrelated quotation/PDF layout styling.
- Must NOT create `send-email.js` in this plan.
- Must NOT change quotation naming series or `customer_new` badge logic.
- Must NOT introduce a shared helper/new module unless absolutely required; prefer isolated changes in existing files.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + lightweight Node assertions; no framework beyond existing `node test_local.mjs` pattern.
- QA policy: Every task includes exact command-level verification and evidence capture.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: keep dependencies explicit; foundation first, then repo/app + ERPNext source fix in parallel, then consolidated verification.

Wave 1: Task 1 (verification harness foundation)

Wave 2: Task 2 (repo-side `print_html` cleanup), Task 3 (`view.js` parity/hardening), Task 4 (frontend dead-path cleanup), Task 5 (ERPNext `Aspen 1.0` source fix)

Wave 3: Re-run Task 1 scenarios as consolidated regression evidence after all code/config changes land

### Dependency Matrix (full, all tasks)
- Task 1 blocks Tasks 2-5 because it establishes repeatable Lead/Customer verification inputs and capture format.
- Task 2 depends on Task 1.
- Task 3 depends on Task 1.
- Task 4 depends on Task 1.
- Task 5 depends on Task 1.
- Final Verification Wave depends on Tasks 1-5 complete.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 1 task → `unspecified-low`
- Wave 2 → 4 tasks → `quick`, `unspecified-low`
- Final Verification → 4 tasks → `oracle`, `unspecified-high`, `deep`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Expand `test_local.mjs` into a two-case regression harness

  **What to do**: Replace the current single hardcoded `text` payload with two explicit scenarios: (a) a guaranteed Lead-path case using a fresh unique email like `crmlead-print-test+<timestamp>@example.com`, and (b) a Customer-path case using an email discovered at runtime by querying one ERPNext `Contact` that already links to a `Customer`. Keep the script framework-free. After each `orcamentoHandler` call, parse the JSON body, store `quotation_id`, `customer_id`, `cliente`, `print_html`, and assert: response success, `print_html` exists, Lead case `customer_id` starts with `CRM-LEAD-`, Customer case `customer_id` does not start with `CRM-LEAD-`, Lead case does not contain `CRM-LEAD`, Customer case keeps the correct name. Add a final fetch against `/api/view?q=<id>` for both cases and assert clean names there too. Use `process.exit(1)` with clear messages on any failure.
  **Must NOT do**: Must NOT install a test framework, must NOT mock ERPNext, must NOT rely on manual console inspection only.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: single-file harness expansion with straightforward assertions
  - Skills: `[]` - no specialized skill required
  - Omitted: `[playwright-cli]` - browser automation unnecessary for this bug

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [2, 3, 4, 5] | Blocked By: []

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `test_local.mjs:1-59` - existing direct-import script structure, `.env` loading, `process.exit(1)` style
  - Pattern: `netlify/functions/orcamento.js:308-333` - response contract fields available to assert against
  - Pattern: `netlify/functions/view.js:3-114` - `/api/view` response path to verify after quote creation
  - API/Type: `package.json:6-8` - confirms no existing test runner/framework
  - Evidence: `real_print.html:732` - confirmed failing raw HTML pattern to ban (`CRM-LEAD-...`)

  **Acceptance Criteria** (agent-executable only):
  - [ ] `node test_local.mjs` exits `0` after adding two named scenarios and automated assertions.
  - [ ] On failure, the script prints a precise assertion message and exits non-zero.
  - [ ] The Lead scenario asserts both `!body.print_html.includes('CRM-LEAD')` and `viewHtml.includes(expectedLeadName)`.
  - [ ] The Customer scenario discovers a real Customer-linked email at runtime and asserts the expected customer name still appears in both `print_html` and `/api/view` output.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Lead and Customer regression harness passes
    Tool: Bash
    Steps: Run `node test_local.mjs > .sisyphus/evidence/task-1-regression-harness.txt 2>&1`
    Expected: Exit code 0; evidence file contains both scenario labels, quotation IDs, and no assertion failures.
    Evidence: .sisyphus/evidence/task-1-regression-harness.txt

  Scenario: Harness fails loudly on leaked CRM-LEAD
    Tool: Bash
    Steps: Temporarily force one assertion to check for an impossible string, run `node test_local.mjs`, then revert before completing task.
    Expected: Script exits non-zero with explicit failure text showing assertion path.
    Evidence: .sisyphus/evidence/task-1-regression-harness-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `test_local.mjs`

- [x] 2. Clean Lead IDs out of `orcamento.js` `print_html`

  **What to do**: In `netlify/functions/orcamento.js`, keep quotation creation logic intact, but after fetching the raw ERPNext print HTML (the block beginning at `pdfUrl` / `printHtml`), add a Lead-only replacement pass before the HTML is returned. Reuse the proven regex target shape from `view.js`: escape the Lead ID, match the `Nome:` label section, and replace the visible Lead ID with the display name. Use `nomeCliente` as the primary display name because it is already the sanitized business-approved name in this request; only fall back to fetched Lead fields if `nomeCliente` is empty. Preserve the existing `<style>` injection and all response keys.
  **Must NOT do**: Must NOT change `party_name`, `customer_name`, quotation creation flow, or Customer-path behavior. Must NOT introduce a new shared helper file.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: small server-side patch in one file
  - Skills: `[]` - no special skill required
  - Omitted: `[refactor]` - overkill for isolated bug fix

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [] | Blocked By: [1]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `netlify/functions/orcamento.js:144-193` - Lead vs Customer entity resolution and `nomeCliente` source
  - Pattern: `netlify/functions/orcamento.js:230-246` - `quotePayload` with `quotation_to`, `party_name`, `customer_name`
  - Pattern: `netlify/functions/orcamento.js:282-319` - raw print HTML fetch and JSON response assembly
  - Pattern: `netlify/functions/view.js:27-44` - existing escaped regex replacement logic to mirror
  - Evidence: `real_print.html:732` - exact failing string shape in raw HTML

  **Acceptance Criteria** (agent-executable only):
  - [ ] Lead-case `body.print_html` returned by `orcamentoHandler` contains the clean customer name and does not contain `CRM-LEAD`.
  - [ ] Customer-case `body.print_html` remains correct and unchanged in visible naming.
  - [ ] Existing response keys (`quotation_id`, `deal_id`, `customer_id`, `customer_new`, `cliente`, `short_url`, `pdf_url`, `print_html`) remain present.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Lead print_html sanitized at source
    Tool: Bash
    Steps: Run `node test_local.mjs > .sisyphus/evidence/task-2-orcamento-print-html.txt 2>&1`
    Expected: Lead case passes source-level assertion that `print_html` has no `CRM-LEAD` and includes expected clean name.
    Evidence: .sisyphus/evidence/task-2-orcamento-print-html.txt

  Scenario: Customer path unaffected
    Tool: Bash
    Steps: In the same evidence run, inspect the Customer scenario assertions emitted by `test_local.mjs`.
    Expected: Customer scenario passes without any Lead-only replacement being triggered.
    Evidence: .sisyphus/evidence/task-2-orcamento-print-html.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `netlify/functions/orcamento.js`

- [x] 3. Keep `/api/view` name resolution in parity with the source fix

  **What to do**: In `netlify/functions/view.js`, preserve the current Lead-name replacement behavior, but align it with the same display-name precedence used in Task 2: `doc.customer_name` first, Lead `first_name`/`lead_name` fallback only when needed, escaped regex replacement, and a post-replacement `console.warn` if `CRM-LEAD` still survives in the rendered HTML for a Lead quotation. Keep the response shape `200 + HTML`; do not introduce a new failure status. Do not change CSS, button injection, or overall route shape.
  **Must NOT do**: Must NOT rewrite the styling block, page title behavior, or non-Lead rendering logic. Must NOT broaden replacement to unrelated fields.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: small consistency hardening in one existing function
  - Skills: `[]` - no specialized skill required
  - Omitted: `[playwright-cli]` - API/HTML verification sufficient

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [] | Blocked By: [1]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `netlify/functions/view.js:15-45` - current printview + Quotation + Lead fetch and replacement logic
  - Pattern: `netlify/functions/orcamento.js:282-319` - source-side HTML cleanup added in Task 2; keep precedence consistent
  - External: `https://github.com/frappe/erpnext/blob/develop/erpnext/selling/doctype/quotation/quotation.py#L247-L257` - `customer_name` population semantics across `quotation_to` types

  **Acceptance Criteria** (agent-executable only):
  - [ ] `/api/view` for a Lead quotation returns HTML containing the clean name and not `CRM-LEAD`.
  - [ ] `/api/view` for a Customer quotation remains unchanged and valid.
  - [ ] If a Lead quotation still contains `CRM-LEAD` after replacement, the function emits a clear `console.warn` message with the quotation ID.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Lead /api/view HTML clean
    Tool: Bash
    Steps: Start local server, then run `curl -s "http://localhost:8888/api/view?q=<LEAD_QUOTATION_ID>" > .sisyphus/evidence/task-3-view-lead.html`
    Expected: Saved HTML contains expected clean customer name and no `CRM-LEAD` string.
    Evidence: .sisyphus/evidence/task-3-view-lead.html

  Scenario: Customer /api/view HTML unchanged
    Tool: Bash
    Steps: Run `curl -s "http://localhost:8888/api/view?q=<CUSTOMER_QUOTATION_ID>" > .sisyphus/evidence/task-3-view-customer.html`
    Expected: Saved HTML contains the expected customer name and no replacement artifacts.
    Evidence: .sisyphus/evidence/task-3-view-customer.html
  ```

  **Commit**: NO | Message: `n/a` | Files: `netlify/functions/view.js`

- [x] 4. Remove the dead raw-print Blob branch from the frontend

  **What to do**: In `public/index.html`, remove the unused `printBlobUrl` block and keep the user-facing open flow pinned to `publicUrl = data.short_url || ${location.origin}/api/view?q=...`. Do not add a new button, do not reintroduce raw HTML preview, and do not touch WhatsApp message templating beyond preserving the existing `publicUrl` behavior.
  **Must NOT do**: Must NOT change queue card layout, badge logic, `buildWhatsApp`, or the visible text of the action buttons except as needed for dead-code removal.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: tiny frontend cleanup in one inline script area
  - Skills: `[]` - no specialized skill required
  - Omitted: `[impeccable]` - no UI redesign needed

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [] | Blocked By: [1]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `public/index.html:891-945` - current `setCardDone` flow, dead `printBlobUrl`, and `publicUrl` usage
  - Pattern: `netlify/functions/view.js:51-114` - downstream route intentionally responsible for printable HTML
  - Metis finding: `printBlobUrl` is currently dead code and a memory leak candidate

  **Acceptance Criteria** (agent-executable only):
  - [ ] `public/index.html` no longer creates a Blob URL from `data.print_html`.
  - [ ] `Abrir orçamento →` continues to point to `short_url` or `/api/view?q=<quotation_id>`.
  - [ ] WhatsApp link generation still uses the same `publicUrl` and customer display name.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Frontend still exposes only cleaned public URL
    Tool: Bash
    Steps: Run `grep -n "printBlobUrl\|URL.createObjectURL\|/api/view\?q=" public/index.html > .sisyphus/evidence/task-4-frontend-grep.txt`
    Expected: Evidence shows `/api/view?q=` remains and Blob URL creation lines are gone.
    Evidence: .sisyphus/evidence/task-4-frontend-grep.txt

  Scenario: WhatsApp/open flow preserved
    Tool: Bash
    Steps: Run a local app flow with `netlify dev`, submit one known order, and capture resulting HTML or console output showing the action link uses `short_url` or `/api/view`.
    Expected: Generated action link never uses raw `print_html`.
    Evidence: .sisyphus/evidence/task-4-open-flow.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `public/index.html`

- [x] 5. Fix the ERPNext `Aspen 1.0` print format at the source

  **What to do**: Back up the current `Print Format` document for `Aspen 1.0` with `GET /api/resource/Print Format/Aspen%201.0`, then update the displayed `Nome:` field to use `{{ doc.customer_name }}` instead of `{{ doc.party_name }}` via `PUT /api/resource/Print Format/Aspen%201.0`. Prefer the simplest source fix: use `doc.customer_name` directly because ERPNext Quotation `set_customer_name()` populates it for Customer, Lead, Prospect, and CRM Deal quotations. Only fall back to conditional Jinja if the existing template structure demands it. If REST is blocked, use ERPNext admin UI as fallback, but still capture the exact before/after template fragment in evidence.
  **Must NOT do**: Must NOT rewrite unrelated header/footer layout, item tables, totals, branding, or CSS. Must NOT rename the print format.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: cross-system config change with precise scope
  - Skills: `[]` - repo skills not needed
  - Omitted: `[playwright-cli]` - REST/API update and HTML fetch are sufficient

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [] | Blocked By: [1]

  **References** (executor has NO interview context - be exhaustive):
  - External: `https://github.com/frappe/erpnext/blob/develop/erpnext/selling/doctype/quotation/quotation.py#L247-L257` - proves `customer_name` is the human display field for all `quotation_to` cases
  - External: `https://github.com/frappe/erpnext/blob/develop/erpnext/selling/doctype/quotation/quotation.json#L161-L198` - field definitions for `quotation_to`, `party_name`, `customer_name`
  - External: `https://github.com/frappe/frappe/blob/develop/frappe/printing/doctype/print_format/print_format.json` - `Print Format` doctype fields (`html`, `css`, `doc_type`, `print_format_type`, etc.)
  - Evidence: `real_print.html:732` - current raw output shows `<p><strong>Nome:</strong> CRM-LEAD-2026-00006</p>`
  - Pattern: `netlify/functions/orcamento.js:282-297` - direct ERPNext printview URL shape used by the app

  **Acceptance Criteria** (agent-executable only):
  - [ ] Direct ERPNext printview HTML for a Lead quotation no longer contains `CRM-LEAD` in the displayed name field.
  - [ ] Direct ERPNext printview HTML for a Customer quotation still shows the correct customer name.
  - [ ] Backup of the pre-change `Aspen 1.0` template fragment is captured in evidence before mutation.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Direct ERPNext Lead print corrected at source
    Tool: Bash
    Steps: Fetch `https://aspenestamparia.l.frappe.cloud/printview?doctype=Quotation&name=<LEAD_QUOTATION_ID>&format=Aspen%201.0&no_letterhead=0` with `Authorization: token $ERPNEXT_TOKEN` and save HTML before and after the template update.
    Expected: After update, saved HTML shows the clean customer name under `Nome:` and no `CRM-LEAD` string.
    Evidence: .sisyphus/evidence/task-5-erpnext-print-after.html

  Scenario: Source fix does not break Customer print
    Tool: Bash
    Steps: Fetch the same printview URL for `<CUSTOMER_QUOTATION_ID>` and save HTML after the update.
    Expected: Saved HTML still shows the correct customer name and no layout corruption around the `Nome:` block.
    Evidence: .sisyphus/evidence/task-5-erpnext-customer-after.html
  ```

  **Commit**: NO | Message: `n/a` | Files: `ERPNext Print Format: Aspen 1.0 (remote config)`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Repo changes: single commit after Tasks 1-4 and successful final verification.
- Recommended commit message: `fix(print): keep quotation customer names human-readable across app and ERPNext`
- ERPNext remote print-format change is not git-tracked; include the exact before/after `Aspen 1.0` snippet and verification evidence in the execution summary/PR notes.

## Success Criteria
- No visible quotation path shows `CRM-LEAD-...` as the customer name.
- App-generated HTML, `/api/view`, and native ERPNext print all agree on the same customer-facing name.
- Customer quotations continue to work unchanged.
- No new dependencies or broad refactors are introduced.
