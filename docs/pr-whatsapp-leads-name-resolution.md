# PR: WhatsApp leads name resolution and group filtering

## Context

The Auto Quote WhatsApp sidebar is populated by `GET /api/whatsapp-leads`.
That flow does not read the displayed name directly from the Quotation detail page.
Instead, it builds each lead from recent Evolution chats plus ERPNext quotation metadata.

This caused two user-facing issues:

1. Group chats could leak into the recent WhatsApp list depending on the Evolution payload shape.
2. Lead names could appear as generic labels like `Aspen Estamparia` or only the first name even when a recent quotation already had the full customer name.

## What changed

### Backend: `api/_functions/whatsapp-leads.js`

- Added `isGroupChat(chat)` to exclude chats that look like groups through multiple signals, not only `@g.us`.
- Added placeholder-name detection so generic values like `Aspen Estamparia`, `Contatos`, or `Você` are not preferred over a real lead name.
- Added `resolveLeadName(chat, messages, extracted, telefone)` to prefer:
  1. extracted name from the conversation,
  2. inbound push name from messages,
  3. chat-level names,
  4. phone fallback.
- Extended quotation metadata caching with `quotationNames`, keyed by quotation ID.
- Added `resolveCanonicalLeadName(lead, converted)` so when a WhatsApp lead matches an existing quotation by phone or email, the list reuses the full ERPNext `customer_name`.

### Frontend: `src/pages/AutoQuotePage.jsx`

- Updated the WhatsApp lead card layout to show name and email on separate lines.
- Removed the previous one-line combined `name — email` rendering that visually hid surnames in narrow cards.

## Matching logic to remember

The current lead naming flow is:

1. Recent chat is loaded from Evolution.
2. Phone is resolved from JID, `senderPn`, extracted conversation content, and contact fallbacks.
3. Name is resolved from chat/message/extracted content while ignoring placeholder values.
4. If that lead matches a known quotation by phone or email, the final displayed name becomes the quotation `customer_name`.

## Good debugging checks later

If the sidebar still shows the wrong name for a lead:

1. Check whether `/api/whatsapp-leads` is returning the wrong `nome` already.
2. Check whether the conversation phone/email actually matches ERPNext quotation data.
3. Inspect the raw Evolution chat payload for `pushName`, `name`, `notify`, `senderPn`, `remoteJid`, and group flags.
4. Compare the quotation `contact_mobile`, `contact_email`, and `customer_name` used for canonical enrichment.

## Expected result

- Group chats should stay out of the Auto Quote WhatsApp list.
- When a recent quotation exists for the same person, the sidebar should show the full customer name, such as `Isabelli Caliari`, instead of only `Isabelli`.
