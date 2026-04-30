# Task 1 — Regression Harness Learnings

## Test structure
- `test_local.mjs` now runs 2 explicit scenarios sequentially: Lead then Customer
- Both use the full extract → orcamento pipeline (Real AI + ERPNext calls)
- Custom `assert()` helper + `failures` counter + `process.exit(1)` on any failure
- `pipeline()` helper runs extract then orcamento for one order string
- `fetchPrintview()` fetches ERPNext printview directly (no localhost dependency)

## Lead scenario
- Uses `crmlead-print-test+{timestamp}@example.com` — guaranteed unique, creates new Lead
- Pipeline: extract (AI → structured order) → orcamento (Lead creation → Quotation)
- `customer_id` correctly starts with `CRM-LEAD-` (confirmed: `CRM-LEAD-2026-0000X`)
- `customer_name` in Quotation is correctly set to `nomeCliente` (seen in `<title>` tag)
- **CRM-LEAD still appears in print_html** — in the "Cliente → Nome:" field, ERPNext renders `party_name` (the Lead ID `CRM-LEAD-XXXXX`) for Lead-type quotations. This is the bug the remaining tasks must fix.

## Customer scenario
- Dynamically discovers a Customer-linked email at runtime by:
  1. Querying `/api/resource/Contact` for all contacts (limit 50)
  2. Fetching each contact's full doc to find `links[].link_doctype === 'Customer'` AND `email_ids[].email_id`
  3. Using the first match found
- Uses the exact Customer name from CRM in the order text to avoid accidental `customer_name` updates
- All assertions pass for this scenario
- Customer used in test run: "Naiana Stach" <naiana.stach@cristalia.com.br>

## Evidence captured
- `task-1-regression-harness.txt` — normal run (2 failures from CRM-LEAD assertions)
- `task-1-regression-harness-error.txt` — intentional break run (3 failures, extra from IMPOSSIBLE_STRING_XYZ)
- The intentional break proves the assertion mechanism correctly causes non-zero exit

## Notes for downstream tasks
- The `print_html` from orcamento includes ERPNext's raw print output. To eliminate CRM-LEAD from display, need to either:
  a. Replace the Lead ID in print_html with the customer name
  b. Or change the Quotation to not show party_name for Lead quotation_to
- The `customer_id` field behavior is correct: Leads get CRM-LEAD- prefix, Customers get their name

## Task 1 — view.js hardening learnings
- `doc.customer_name` from ERPNext is already the correct human-readable name for all `quotation_to` types (set by `set_customer_name()`) — Lead fetch is only needed as fallback when `customer_name` is empty or still contains `CRM-LEAD`
- The Aspen 1.0 print format template renders the Lead ID (`CRM-LEAD-XXXXX`) in the "Nome:" field for Lead quotations, requiring regex replacement
- The regex `(Nome(?:<[^>]+>)*\s*:(?:\s|&nbsp;|<[^>]+>)*)${escapedParty}` replaces the Lead ID after "Nome:" but CRM-LEAD can appear in other positions too — added a second global `replace(new RegExp(escapedParty, 'g'), cleanName)` to catch all remaining occurrences
- Test uses `fetchPrintviewViaViewHandler()` which calls the view.js handler directly (not raw ERPNext fetch), letting it test actual `/api/view` behavior including name resolution
- Both assertions pass: no CRM-LEAD in HTML + customer name present
