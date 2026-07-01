# WhatsApp Inbox CRM Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) `superpowers:executing-plans` implement plan task-by-task. Steps use checkbox (`- [ ]`) syntax tracking.
>
> **Goal:** Show a saved CRM match from `#/leads` inside the WhatsApp inbox commercial panel, with one-click navigation to the matched record.
>
> **Architecture:** Add a focused CRM match helper on the backend, persist separate CRM link fields on WhatsApp conversations, expose a selected-conversation detail payload with `crmMatch`, and render it in the inbox panel without touching the pre-quote link.
>
> **Tech Stack:** TypeScript ESM Vercel functions, React 19 + Vite 6, Node `node:test`, Playwright.

## Global Constraints

- ESM only — `.js` imports require explicit extension; standalone scripts use `.mjs`.
- Frontend source lives in `src/` as `.ts`/`.tsx` and uses the `@/*` alias.
- Hash-based routing only; navigation to leads must use the existing `navigate('/leads/...')` path.
- No new dependencies without explicit approval.
- User-facing API errors must stay in Brazilian Portuguese.
- Do not reuse `linkedLeadId` for CRM lead/customer matching; keep pre-orçamento links intact.
- Do not expose raw ERPNext stack traces or error bodies to the UI.

## File Structure

- `api/_functions/lib/whatsapp-crm-match.ts` — new CRM lookup and match-selection helper, isolated from the inbox handler.
- `api/_functions/lib/whatsapp-conversations-store.ts` — persist new CRM link fields on conversation records.
- `api/_functions/whatsapp-conversations.ts` — extend the conversation GET response with `crmMatch` and save resolved matches.
- `src/lib/whatsappInboxApi.ts` — add a typed fetch helper for a single enriched WhatsApp conversation.
- `src/pages/WhatsAppInboxPage.tsx` — fetch the enriched conversation and render the CRM card/button in the commercial panel.
- `tests/unit/whatsapp-crm-match.test.ts` — pure matcher coverage.
- `tests/unit/whatsapp-conversations-store.test.ts` — persistence/normalization coverage.
- `tests/unit/whatsapp-conversations.test.ts` — handler response coverage.
- `tests/whatsapp-inbox.spec.js` — Playwright coverage for the panel card and navigation.

## Task 1: Backend CRM matching + persistence

**Files:**

- Create: `api/_functions/lib/whatsapp-crm-match.ts`
- Modify: `api/_functions/lib/whatsapp-conversations-store.ts`
- Modify: `api/_functions/whatsapp-conversations.ts`
- Test: `tests/unit/whatsapp-crm-match.test.ts`
- Test: `tests/unit/whatsapp-conversations-store.test.ts`
- Test: `tests/unit/whatsapp-conversations.test.ts`

**Interfaces:**

- Consumes: `WhatsappConversation`, `WhatsappConversationStoreDeps`, ERPNext list/read helpers already used by `leads-clients` and `client-detail`.
- Produces: `WhatsappCrmMatch | null`, new conversation fields `linkedCrmEntityId`, `linkedCrmEntityType`, `linkedCrmMatchSource`.

- [ ] **Step 1: Write failing matcher tests**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhatsappCrmMatch } from '../../api/_functions/lib/whatsapp-crm-match.js';

it('prefers exact phone over email and name', async () => {
  const match = await resolveWhatsappCrmMatch({
    conversation: { phone: '5511999999999', displayName: 'Maria', remoteJid: '...' } as any,
    deps: fakeDeps,
  });

  assert.deepEqual(match, {
    id: 'LEAD-001',
    tipo: 'lead',
    nome: 'Maria Silva',
    telefone: '5511999999999',
    email: 'maria@example.com',
    matchSource: 'phone',
  });
});
```

Expected: `node --test` fails because the helper does not exist yet.

- [ ] **Step 2: Run the targeted unit tests and confirm the failure**

Run:

```bash
TZ=UTC node --test tests/unit/whatsapp-crm-match.test.ts tests/unit/whatsapp-conversations-store.test.ts tests/unit/whatsapp-conversations.test.ts
```

Expected: fail with missing export / unresolved helper assertions.

- [ ] **Step 3: Implement the minimal backend matcher**

```ts
export interface WhatsappCrmMatch {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  telefone: string | null;
  email: string | null;
  matchSource: 'phone' | 'email' | 'name';
}

export async function resolveWhatsappCrmMatch(input: {
  conversation: WhatsappConversation;
  deps: WhatsappConversationStoreDeps & { /* ERP readers */ };
}): Promise<WhatsappCrmMatch | null>;
```

Implementation notes:

- normalize phone/email before comparison;
- try phone, then email, then conservative name fallback;
- if a saved CRM link exists, validate it first and reuse it when still valid;
- if the saved link is invalid, clear it and resolve again;
- persist the chosen CRM link back onto the conversation.

- [ ] **Step 4: Extend the conversation store to carry CRM link fields**

```ts
export interface WhatsappConversation {
  // existing fields...
  linkedCrmEntityId?: string | null;
  linkedCrmEntityType?: 'lead' | 'cliente' | null;
  linkedCrmMatchSource?: 'phone' | 'email' | 'name' | null;
}
```

Update normalization and update-patch logic so these fields survive read/write cycles and default to `null`.

- [ ] **Step 5: Extend the GET /api/whatsapp-conversations response for a single conversation**

```ts
if (qs.id) {
  const conversation = await getWhatsappConversation(qs.id, deps);
  const crmMatch = await resolveWhatsappCrmMatch({ conversation, deps });
  return jsonResponse(200, { success: true, data: { ...conversation, crmMatch } });
}
```

Keep the pre-orçamento flow untouched; only the CRM match payload should be new.

- [ ] **Step 6: Re-run the targeted unit tests until green**

Run:

```bash
TZ=UTC node --test tests/unit/whatsapp-crm-match.test.ts tests/unit/whatsapp-conversations-store.test.ts tests/unit/whatsapp-conversations.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the backend work**

```bash
git add api/_functions/lib/whatsapp-crm-match.ts api/_functions/lib/whatsapp-conversations-store.ts api/_functions/whatsapp-conversations.ts tests/unit/whatsapp-crm-match.test.ts tests/unit/whatsapp-conversations-store.test.ts tests/unit/whatsapp-conversations.test.ts
git commit -m "feat: resolve crm matches in whatsapp inbox"
```

## Task 2: Inbox API + commercial panel UI

**Files:**

- Modify: `src/lib/whatsappInboxApi.ts`
- Modify: `src/pages/WhatsAppInboxPage.tsx`
- Test: `tests/whatsapp-inbox.spec.js`

**Interfaces:**

- Consumes: `fetchWhatsappConversation(id)`, `WhatsappCrmMatch`, `navigate('/leads/...')`.
- Produces: a commercial panel card with name/phone/email/type and a small “Abrir lead” button.

- [ ] **Step 1: Write the failing Playwright scenario**

```js
await page.route('**/api/whatsapp-conversations?id=wa_1', async (route) => {
  await route.fulfill({
    json: {
      success: true,
      data: {
        id: 'wa_1',
        phone: '5511999999999',
        displayName: 'Maria',
        status: 'new',
        crmMatch: {
          id: 'LEAD-001',
          tipo: 'lead',
          nome: 'Maria Silva',
          telefone: '5511999999999',
          email: 'maria@example.com',
          matchSource: 'phone',
        },
      },
    },
  });
});

await expect(page.getByText('Cadastro encontrado')).toBeVisible();
await expect(page.getByRole('button', { name: /Abrir lead/ })).toBeVisible();
```

Expected: the test fails because the UI does not fetch/render the enriched CRM payload yet.

- [ ] **Step 2: Add the inbox API helper and detail type**

```ts
export interface WhatsappConversationDetail extends WhatsappConversation {
  crmMatch?: WhatsappCrmMatch | null;
}

export async function fetchWhatsappConversation(id: string): Promise<WhatsappConversationDetail> {
  const result = await apiGet<ApiEnvelope<WhatsappConversationDetail>>(
    `/whatsapp-conversations?id=${encodeURIComponent(id)}`
  );
  return result.data;
}
```

- [ ] **Step 3: Fetch the enriched conversation in the page and render the card**

```tsx
const [selectedConversation, setSelectedConversation] = useState<WhatsappConversationDetail | null>(null);

useEffect(() => {
  if (!selectedId) {
    setSelectedConversation(null);
    return;
  }

  fetchWhatsappConversation(selectedId).then(setSelectedConversation);
}, [selectedId]);
```

Render a compact card in the right panel with:

- nome
- telefone
- email
- tipo (`Lead` / `Cliente`)
- match source badge
- small button that calls `navigate('/leads/lead/${id}')` or `navigate('/leads/cliente/${id}')`

- [ ] **Step 4: Re-run the inbox Playwright test until green**

Run:

```bash
npx playwright test tests/whatsapp-inbox.spec.js
```

Expected: PASS, with the new CRM card visible and the button routing to `/leads/...`.

- [ ] **Step 5: Commit the UI work**

```bash
git add src/lib/whatsappInboxApi.ts src/pages/WhatsAppInboxPage.tsx tests/whatsapp-inbox.spec.js
git commit -m "feat: show crm match in whatsapp inbox"
```

## Task 3: Full regression pass

**Files:** none expected unless a regression appears.

**Interfaces:**

- Consumes: the unit and e2e suites above.
- Produces: verified end-to-end behavior with no regressions in pre-orçamentos or WhatsApp messaging.

- [ ] **Step 1: Run the full unit suite**

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run the WhatsApp inbox e2e suite**

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 3: Run a build sanity check**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Fix only regressions introduced by this feature**

If anything fails, patch only the files in scope above and re-run the same command.

## Coverage Check

- Spec requirement: only real `/leads` records — covered by Task 1 match helper.
- Spec requirement: best match only — covered by Task 1 fallback rules.
- Spec requirement: saved CRM link on the conversation — covered by Task 1 store changes.
- Spec requirement: commercial panel card + button — covered by Task 2 UI changes.
- Spec requirement: separate from pre-orçamento linkage — covered by the global constraints and Task 1 field names.
- Spec requirement: no raw ERP errors in UI — covered by backend error handling and Task 2 error state.
