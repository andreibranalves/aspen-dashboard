# Work Plan: Fix Quotation PDF Name Rendering

## Goal
Fix the Quotation PDF rendering in `view.js` so that the customer's actual name is displayed instead of the Lead ID (`CRM-LEAD-...`).

## Context
When Frappe renders the Quotation print format, the Lead ID is inserted as the `party_name`. `view.js` attempts to replace this with the human name (`first_name` or `customer_name`), but the existing regex `(Nome:\s*)` fails because Frappe injects HTML tags (like `<strong>Nome:</strong>`) around the label and value.

## Scope
- **IN**: Update the regex replacement logic in `netlify/functions/view.js` to be robust against HTML tags and entities.
- **OUT**: Modifying the ERPNext print format directly.

## Task 1: Update Regex in view.js
**File**: `netlify/functions/view.js`

**Action**:
Update the `regex` definition to handle HTML tags before/after the colon, and possible `&nbsp;` entities.

Replace:
```javascript
const regex = new RegExp(\`(Nome:\\\\s*)\${escapedParty}\`, 'g');
```
With:
```javascript
const regex = new RegExp(\`(Nome(?:<[^>]+>)*\\\\s*:(?:\\\\s|&nbsp;|<[^>]+>)*)\${escapedParty}\`, 'g');
```

## Final Verification Wave
Run a quick test script to verify the regex replacement works on various edge cases:
1. Create `test_regex.mjs` containing the new regex and test cases:
   - \`"<strong>Nome:</strong> CRM-LEAD-2026-00006"\`
   - \`"<b>Nome</b>: CRM-LEAD-2026-00006"\`
   - \`"Nome: <span>CRM-LEAD-2026-00006</span>"\`
   - \`"Nome:&nbsp;CRM-LEAD-2026-00006"\`
2. Ensure the output preserves the tags but replaces the Lead ID with the clean name.
3. Clean up the test script after verification.
