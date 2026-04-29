# Work Plan: Fix Display Names in Quotation (`fix-display-names`)

## Objective
Ensure the clean display name (e.g., "Andrei") is used in the Quotation PDF and remarks, instead of the ERPNext ID (e.g., "Andrei - 1").

## Architecture & Data Flow
1. **`orcamento.js`**: Explicitly set `customer_name` in the Quotation payload.
2. **`view.js`**: Ensure the HTML rendering logic uses the clean name.

## Execution Tasks

### Task 1: Update Quotation Payload in `orcamento.js`
- [x] Add `customer_name: nomeCliente` to the `quotePayload` object.
- [x] Verify that `remarks` already uses `nomeCliente`.

### Task 2: Update HTML Rendering in `view.js`
- [x] Modify the HTML template or the data extraction logic to ensure "Nome:" displays the clean name.
- [x] If necessary, use a regex to replace the ID with the clean name in the final HTML.

## Final Verification Wave
- [x] Run `node test_local.mjs` and verify the generated Quotation in ERPNext has the correct `customer_name`.
- [x] Access the `view` function for a quotation with a suffixed ID and verify the PDF/HTML shows the clean name.
