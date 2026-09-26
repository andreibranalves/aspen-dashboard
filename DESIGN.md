---
name: Aspen Orçamento
description: "Normative UI contract. Token values live only in src/index.css."
---

# Aspen UI Design Contract

Status: the only normative Aspen UI document. Journey sections below record
approved behavior; the foundation and component sections apply to every page.

## Product character

Aspen is a quiet, precise, operational commercial application for one
experienced operator. Structure and meaning come from typography, alignment,
spacing, borders, density, and semantic color.

## Foundation (Órbita)

`src/index.css` is the only source of color values: the dark palette on
`:root` and the light overrides on `:root[data-theme='light']`. This document
names roles; it does not copy hex values, so it cannot drift from the code.

| Role | Tokens | Use |
| --- | --- | --- |
| Canvas and page | `canvas`, `page` | outer frame and workspace background |
| Surfaces | `surface`, `surface-subtle`/`raised`, `surface-hover`, `surface-selected`, `input-surface`, `segment-active` | cards, quiet insets, hover, selection, fields, active segment |
| Borders | `line`/`border`, `border-strong`, `border-control` | separators, emphasized edges, field outlines |
| Text | `fg`, `fg-muted`, `text-tertiary`, `text-disabled` | primary, secondary, metadata, disabled |
| Action | `primary`, `on-primary`, `primary-soft`/`primary-soft-ink`, `link`, `primary-text` | buttons, active tab, links |
| Status | `success`, `warning`, `destructive`, `info` (+ `-fill` for solid buttons) | status text, icons, tinted surfaces |
| Focus | `focus` | the single focus outline |
| Charts | `chart-one`…`chart-four`, `chart-neutral` | series in this fixed order (palette validated for color blindness and contrast in each theme, every pair distinct so any two can touch in a pie); neutral for a category with no identity, such as `Outros`; missing data (`Sem origem`) is a thin `border-strong` slice, never a fifth color |

Primary blue is an action and selection color, not decoration. Every status
also carries text or an icon; color is never the only signal.

### Typography

Manrope is the product font with `tabular-nums` globally. Monospace is only
for SKUs and identifiers.

Sizes are theme tokens in `src/index.css`; arbitrary `text-[Npx]` is rejected
by lint.

| Role | Class / weight | Where |
| --- | --- | --- |
| Dialog title | `text-lg` 18px / 700 | `Dialog`, `Drawer` |
| Section title | `Heading level="section"` 16px / 600 | top-level cards in a page |
| Sub-section | `Heading level="subsection"` 14px / 600 | groups inside a section card |
| Card title | `Heading level="card"` 15px / 600 | kanban and grid cards |
| Step subject | `Heading level="subject"` 20px / 700 | what a step card is about (client, issued quote) |
| Eyebrow | `Heading level="eyebrow"` 12px / 600 caps | group labels |
| Body / controls | `text-sm` 14px / 400–600 | text, inputs, selects, buttons |
| Secondary / meta | `text-compact` 13px | page meta, tabs, breadcrumb (the page name) |
| Caption | `text-xs` 12px | field labels, table headers |
| Badge | `text-2xs` 11px / 600 | `StatusBadge`, quality badges |
| Micro | `text-3xs` 10px | counters, dense captions |

Display numbers use `text-hero` (32px) and `tracking-display`. Elevation uses
`shadow-overlay` (dialogs), `shadow-floating` (popovers) and `shadow-bar`
(bottom action bars). Headings in `src/features` and `src/app` go through
`Heading`; a raw `h1`–`h6` with type classes fails lint.

Icons use 12, 14, 16 or 20px; 24, 32 and 48 only in empty states and
placeholders. Icons inside `Button` and `MenuItem` are forced to 16px.

Stacking uses named layers only (`z-N` fails lint): `z-sticky` 10 (sticky
headers), `z-nav` 30 (mobile sidebar and its backdrop), `z-floating` 40
(menus, popovers, autocomplete, bottom bars), `z-overlay` 50 (dialogs).

### Radius roles

`src/index.css` defines the radius roles in `@theme inline` and clears
Tailwind's size scale, so `rounded-md/lg/xl` do not exist. Pick by role:

| Class | Value | Use |
| --- | --- | --- |
| `rounded-xs` | 4px | tiny marks, chart bars, `kbd` |
| `rounded-badge` | 6px | status badges, segmented triggers, menu items |
| `rounded-control` | 11px | buttons, fields, inline alerts, menus, small insets |
| `rounded-nav` | 14px | sidebar items, top search |
| `rounded-card` | 16px | cards, panels, dialogs, drawers (features use `Card`, not the class) |
| `rounded-shell` | 20px | the workspace frame |
| `rounded-full` | — | avatars and icon discs only |

### Focus

One global `:focus-visible` outline (2px, `--focus`, 2px offset). Components
never add their own focus ring. Rows inside clipped containers add
`focus-inset` to draw it inward.

### Controls

Every control is 32px with `px-3` and `text-sm`: buttons (`default`, and
`icon` for icon-only), fields and selects. `xs` 28 only in dense rows (message
timeline, split cards); `inline` (no box and inherited font size, for links in
text or tables). `Input` and `Select` take `size` `default` 32 or `xs` 28;
`Select size="icon"` is the compact move-to menu. Tabs, status
filters and sidebar items take the same `buttonSizes` as `Button`. Filled
buttons show a tinted disabled state at full opacity; quiet variants fade.

Appearance comes from props, never from `className` on a `components/ui`
primitive or a `components/shared` composition (`settings.shadcn.ui` covers
both). `eslint.config.js` enforces this with `shadcn/no-restyle`
(`className` may carry layout only, plus the per-component `contracts`) and
`shadcn/no-arbitrary-values`. When a call site needs a new look, add a variant. In `src/features` and `src/app`,
`no-restricted-syntax` also rejects decorative colors (`sage`, `orange`,
`taupe` outside chart tokens), `.toFixed(` (use the formatters), raw
`<textarea>` and text glyphs used as icons. Actions use `Button` or
`MenuItem`; a plain `<button>` is only for list options, selectable cards,
disclosure toggles and navigation chrome. `no-restricted-syntax` enforces this in
`src/features` and `src/app`: a raw `<button>` must declare `role`, `aria-expanded`,
`aria-pressed`, `aria-selected` or `aria-current`; anything else uses
`eslint-disable-next-line no-restricted-syntax -- <motivo>`:

| Component | Props |
| --- | --- |
| `Button` | `variant`: `default`, `destructive`, `outline`, `outline-destructive`, `outline-ink` (on colored panels), `secondary`, `soft`, `ghost`, `ghost-muted`, `ghost-destructive`, `ghost-muted-destructive` (remove icons), `link`, `success` |
| `Table` | `density`: `default` (lists), `compact` (documents), `dense` (editable tables in cards); `edges`: `flush`, `inset` |
| `TableRow` | `selected`, `tone="warning"`, `interactive` |
| `Card` | `variant`: `default`, `outline`, `inset`; `padding`: `none`, `sm`, `default`, `lg`; `as` for the tag |
| `Text` | `variant`: `body`, `title` (row name), `meta`, `caption`, `label`, `value`, `id` (SKU), `record` (record number a row opens); only `id`/`record` are mono; `as`, `truncate` |
| `Field` | `label`, `hint`, `error`, `labelHidden`; wires `id`, `aria-describedby` and `aria-invalid` into the `Input`, `Select`, `Textarea` or `MoneyInput` inside it (one control per field) |
| `MoneyInput` | `value: number \| null`, `onValueChange`; shows `1.234,56`, keeps what is typed while focused |
| `Input` | `size`, `hideSpinButtons` |
| `Heading` | `level`: `section`, `subsection`, `card`, `eyebrow`; `as` for the tag |
| `MenuItem` | `tone`: `default`, `destructive`; `asChild` for links |
| `Textarea` | `variant`: `default`, `code`, `bare` (composer inside a bordered box) |
| `StatusBadge` | `status` maps to a tone; `tone` overrides it |
| `EmptyState` / `ErrorState` | `variant`: `card` (own block), `dashed` (inside a card or list), `bare` (fills a framed pane) |
| `Skeleton` | `variant`: `rect` (controls), `card`, `circle`, `text` |

## Layout

`Layout` owns the frame: sidebar, workspace scroll, TopBar and, below `md`,
`BottomNav`. Pages render inside `PageShell` (fluid width, 16px rhythm).
Nothing in the page is absolutely positioned against the shell.

Navigation comes from `nav` in `src/app/routes.tsx`: `group` places a
destination in the sidebar (**Operação**, **Cadastros**, **Acompanhamento**;
Configurações in the footer) and `bottom` places it in the mobile bottom bar
(Atendimento, Orçamentos, Comercial, Pedidos; `Mais` opens the sidebar with the
rest). `Novo orçamento` is the single global primary action, at the top of the
sidebar (below `md`, under `Mais`); page headers do not repeat it, while empty
states and client-prefilled entries keep their contextual version. `T` opens a
new task anywhere (linked to the order or client on screen); Tarefas also has
`Nova tarefa`. The TopBar names the page and holds only that page's actions:
desktop shows the breadcrumb, below `md` back to the parent plus the page name,
and the canvas/shell double frame is dropped. It is one button tall (32px) and
sits in the workspace padding, with the same gap below it before the page.

`PageHeader` is the first element of every page. The breadcrumb is the
visible page name, so its `h1` is screen-reader only and its `actions`
(secondary → primary) render in the TopBar through a portal. What stays in the
page, in normal flow, is the entity context row: optional `leading` visual,
`eyebrow`, operational `description` and `meta` (status, revision, dates).
Descriptions are context (period, counts), never slogans.

List pages (Clientes, Orçamentos, Pedidos, Produtos) use `ListPageLayout`
(24px rhythm; `BulkActionBar` reserves its space only while visible) with an optional summary
row, then `ListSection`: filters → content → pagination, 20px apart, on one
surface card (`surface={false}` when the content is already a card grid).
State, search and selection stay in the page.

`scripts/check-ui-ratchet.mjs` (in `verify:fast`) counts, in `src/features`
and `src/app`: vertical margins on children (`mt-*`, `mb-*`, `my-*`), hand-built
`rounded-card` surfaces, raw `<label>`, arbitrary Tailwind values and loose
`text-xs`. Counts may only go down: use `gap`/`space-y`, `Card`, `Field`,
`Text` and layout tokens, and lower the limit in the same change.

`npm run test:visual` compares the main screens against
`tests/visual/__screenshots__/` with mocked API data and a fixed clock,
tolerating only font antialiasing noise (100 pixels). It runs locally, not in CI. After an intentional visual change,
review the new images and run `npm run test:visual:update`.

Layout widths are tokens: `max-w-form` (1060px) for long forms and `w-aside` /
`grid-cols-main-aside` (336px) for the detail side panel; journeys migrate
their fixed widths to them as they land. Auto keeps its two-panel split. Horizontal strips that may overflow (tabs, filters) use
`scrollbar-none`; fixed bottom bars use `pb-safe` and sit above
`--mobile-nav-h`; a mobile view that must fill the screen uses `h-workarea`.
Custom utilities never reuse a theme key name (`h-workspace` would resolve to
the `--spacing-workspace` token).

## Components: use X for Y

| Need | Use | Notes |
| --- | --- | --- |
| Modal task or confirmation | `Dialog` / `ConfirmDialog` (`components/ui/dialog`, `shared/ConfirmDialog`) | Radix: Escape, focus trap, restoration; `dismissible={false}` while saving |
| Side panel | `Drawer` / `DetailDrawer` | read-mostly drill-down |
| Sections of a page | `Tabs` + `TabList` + `TabPanel` (`variant="page"`) | or `TabBar` when panels live elsewhere |
| Alternate views/modes | `TabBar variant="segmented"` | Lista/Quadro, Conversa/Manual |
| Search in a list | `SearchField` inside `PageToolbar` | 286px cap |
| Pagination | `ListPagination` | shows `de X` only when the endpoint returns a total |
| Status filter with counts | `StatusFilterBar` | above lists, instead of StatCards + status select; `count: null` while loading |
| List on both widths | `DataList` | table from `md`, stacked rows below; `getHref` makes rows real links |
| Primary action on mobile | `MobileActionBar` | fixed above `BottomNav` below `md`, one primary action |
| Long form save | `StickySaveBar` | only while dirty |
| Metrics row | `StatCard` in `StatGrid` | pass `loading`; never show 0 before data |
| Grouped content | `Card` | never a hand-built `rounded-card` surface |
| Form field | `Field` + control | label, hint and error wired to the control |
| Money field | `MoneyInput` in `Field` | never `toFixed` in UI |
| Exports of a page | `ExportMenu` with `ExportCsvButton` items | one Exportar button |
| Nothing to show | `EmptyState` | distinguish empty base vs no results for filters |
| Failed load | `ErrorState` | same geometry as `EmptyState`, `role="alert"`, retry |
| Message in context | `InlineAlert` | tone in icon/border, text in body color, one action |
| Status | `StatusBadge` | labels from `lib/statusLabels` |
| Entity avatar + name | `EntityIdentity` | |

Primitives in `components/ui` know no domain. Shared compositions live in
`components/shared`. A new variant goes into the shared component, not into a
local copy. Metrics are never computed from the current page and shown beside
global totals.

## Component and state rules

Rows that open a record support keyboard activation and visible focus.
`onClick` on a non-interactive element (`div`, `span`, `li`, `td`…) fails lint:
use `Button`, `MenuItem` or `TableRow`. A pointer-only layer (click outside to
close) declares `aria-hidden="true"`; a wrapper that only calls
`stopPropagation` is allowed.
Icon-only controls have accessible names (`Button size="icon"` without
`aria-label` fails lint). Hover affordances have focus-visible
or persistent keyboard and touch equivalents.

Every remotely loaded view has loading, empty, no-results, error, and retry
states as applicable. Missing relationships stay missing; they are not turned
into zero, a fake link, a UUID-as-name, or invented metrics. Errors are short
Brazilian Portuguese recovery messages and never expose raw integrations,
stack traces, or database details.

## Approved issue #210 adaptations

The Pedidos journey preserves all existing behavior and makes these explicit
visual/structural decisions:

- The list retains every supported period and status, combined search,
  debounce, stale-response protection, page-size selector, export menu,
  query-history return, and `has_more` pagination contract.
- Pagination (`ListPagination`) shows `Página N` exactly once, with
  Anterior/Próximo and the page-size selector in the footer. It never invents a total count or displays
  `de X` when the endpoint supplies only `has_more`.
- The list does not fetch each detail to invent an item count. The known
  columns remain pedido, cliente, status, entrega, valor, with date and source
  quotation as honest secondary context. Missing source has no fake link.
- The existing commercial summary remains a secondary, initially closed
  section fixed to its own 30-day period and independent of list filters.
- The detail keeps confirmed items, confirmed total, optional-field
  semantics and source identifiers. Billing and delivery percentages were
  replaced by the Produção section (#325): stage, forward-only advance, stage
  dates, entrada/saldo and "Recebido R$ X de R$ Y", plus an Anotações history.
  Pedidos opens on the Produção board; the list lives in the Todos tab.
- The detail has one contextual return through the existing shell/history
  behavior. No duplicate main-body progress section or invented item totals is
  added.

These are adaptations of the medium-fidelity frames, not new business rules.
The sketches' fictional names, totals, item counts, and statuses are not app
fixtures and are never copied into production data.

## Approved Orçamentos consultation slice

The Orçamentos consultation journey applies this same contract to the list and
detail/revision views. The initial implementation used the Figma structural
references `8:2` (list), `79:186` (two-item review), `81:265` (new draft
revision), and `81:599` (issued revision and preparation for delivery). The
related confirmation references `86:38` and `89:51` were consulted but do not
define additional UI in this slice.

The list keeps the existing status/search query state, batch selection and
actions, export behavior, pagination, and API response semantics. Its visual
hierarchy is title, `StatusFilterBar` with the authoritative counts (no metric
cards), compact search, and `DataList` rows that are real links with secondary
row actions. E-mail delivery remains row context (a sent mark beside the
status), not a column. The revision shows only when it is above 1.

The detail keeps the existing draft/revision, emission, PDF, WhatsApp, e-mail,
approval/order, loss, deletion, and history workflows. Issued views follow the
subsequent detail references supplied by the user: client, complete item table
and totals, and commercial conditions appear together without tabs. The client
card retains Ver cliente, Abrir no CRM, and Ver orçamentos anteriores.
Commercial sections respect their saved visibility and titles, using the existing
display-title normalization, and retain their original meanings. Detalhes do
documento and Histórico e revisões use native collapsible sections. The header
meta labels its dates (`Data`, `Válido até`). Prévia do documento, Nova revisão
and Mais ações stay in the header; Preparar envio shows there only while the
Comunicação panel is stacked (`md` to `xl`). Below `md` the header keeps Mais
ações (with Nova revisão), items render as stacked rows, and `MobileActionBar`
carries the primary pair: Prévia + Preparar envio (issued), Editar + Emitir
(draft), Cancelar + Salvar (editing). Acompanhamento comercial groups delivery
and negotiation actions in a 336px side panel at extra-large widths and stacks
below the content on smaller screens. Draft review and editing
use the same detail shell with totals and consequential emission actions in the
side panel, except that editing recovers the full table width. No business
rule, endpoint, persistence model, or data source is introduced by this visual
slice.

## Approved Novo orçamento entry slice

The new-entry journey uses one page at `#/novo-orcamento` with the existing
`#/auto` and `#/manual` aliases. A segmented mode control in the header
switches between `Conversa` and `Manual`; both modes share client identity,
origin, address, items, terms, review, and summary state. Manual uses a main
column with the summary/action column (`grid-cols-main-aside` from `xl`);
conversation uses a two-panel input/result layout from `lg`, each panel as tall
as its content. Client and address editing use a right-side dialog with Escape,
focus placement, and focus restoration.

Below `md` both modes are fully operable: the conversation result follows the
order (the page scrolls to it when a new draft arrives), result and manual items
render as stacked rows with their inputs (quantity and price side by side), and
Manual carries its total with Revisar emissão in `MobileActionBar`. Components
that must mount only one layout use `useMediaQuery(MOBILE_MEDIA_QUERY)` instead
of rendering both and hiding one.

Auto drafts remain in the versioned `sessionStorage` envelope and Manual drafts
remain in versioned `localStorage`; existing legacy reads and TTL behavior are
unchanged. A new extraction result is isolated for explicit review when the
active draft has work. Existing pricing, preview, draft-save, idempotent issue,
concurrency-token, origin-prefill, and quotation-detail contracts remain the
source of truth. This slice changes presentation and in-memory coordination,
not commercial calculations, persistence schema, emission, or transport rules.

## Approved Clientes journey

The Clientes journey applies the shared contract to the list, quick-view drawer,
full profile, and edit states. The implementation uses the current Figma
structural references `13:2` (list), `13:119` (quick view), `13:247` (profile),
`13:334` (edit), `213:50` (export/actions), and `213:171` (archived state).

The list keeps the existing `/leads-clients` search, status, pagination, CSV
export, selection, archive, restore, create, and detail navigation contracts.
It uses the fields the endpoint actually provides: client, contact, document,
status, and row actions. The Figma examples' quotation counts and monetary
metrics are illustrative and are not displayed without an authoritative data
contract. WhatsApp and e-mail remain available through the contact cell and
context actions.

The quick-view drawer keeps the reusable `DetailDrawer` API and exposes the
projected client identity once in its header, contact, document, address, notes, latest quotation,
and the existing contextual actions. The latest quotation has one access point
in its content instead of a duplicate header action. Missing relationships
remain absent. The
full profile separates cadastro from recent commercial activity and links to
the existing quotation, CRM, and order routes when those records exist.

The edit state uses the existing create/update endpoints, one save action, the
complete address fields, notes, validation, and navigation guards for unsaved
changes. New quotation keeps the existing client prefill. Archive and restore
remain confirmed, reversible actions through the existing API contracts; no
new persistence, UUID identity, fake history, metrics, tabs, or actions are
introduced by this visual slice.

Responsive evidence covers both themes at `1280x800`, `1440x900`, `1024x800`,
and `390x844`. The desktop profile uses a two-column cadastro/activity layout;
the narrow layout places recent activity before cadastro and keeps the drawer
full-width.

## Revamp contract (2026-09)

Mobile is a first-class target: every journey, including creating, reviewing,
issuing, and sending a quotation, is operable at `390x844`. The foundation,
shell, and journey rules below are in place; the ones under Still open are the
remaining work, tracked by the ratchets.

### Journey rules

- Lists use `StatusFilterBar` and `DataList`; details and Novo orçamento use
  `MobileActionBar`; long forms use `StickySaveBar`.
- Atendimento: below `lg` the list and the
  open conversation swap, the conversation fills the work area (`h-workarea`)
  with the composer at the bottom, and the page title hides while it is open.
  The context column exists only with an open conversation. Message selection
  for a quotation is an icon toggle beside the bubble; attachments use a
  paperclip button, never a raw file input.
- Comercial: each queue action is one row from `md`
  (time, contact, one due badge, chevron) and two lines below it; the whole
  row opens the action. Negócios never shows internal ids or columns without
  data; linked proposals open from a text link.
- Pedidos: production cards show client, number and
  value, then the deadline bar and a full-width advance action; empty stages
  are narrow on desktop, and below `md` the board becomes one stage at a time
  chosen in a `StatusFilterBar`. The detail carries the client and final
  deadline in the header meta (no client card), and deposit amounts use
  `MoneyInput`.
- Clientes: the list is a `DataList` (client with
  company contact and city, contact links, document from `lg`, status, row
  actions); below `md` the row actions fold into the row menu, which also holds
  Ver orçamentos. The profile never repeats the client name under the title,
  keeps one Resumo comercial block with the latest quotation as a link, and
  shows pipeline stages through `pipelineLabel`. `DataList` mounts only the
  layout for the current width. `EntityIdentity` names are 14px over a 12px
  secondary line.
- Catálogo: products are a dense `DataList` (product,
  SKU, category from `lg`, unit, base price, status, archive) instead of
  colored cards; exports sit in one `ExportMenu`; sets show their item count as
  text. The product detail keeps its direct edit mode (Salvar/Cancelar in the
  header, in `MobileActionBar` below `md`); a missing image is a neutral block.
- Placeholders never repeat the label; they only show a format (`LNC-SED-70`,
  `0,00`).
- Envios, Resultados, Tarefas and Configurações: Envios
  filters pending deliveries with a `StatusFilterBar` (counts from the summary,
  no metric cards) and keeps Limpar fila as a quiet icon with confirmation;
  Resultados puts its four numbers in one row from `lg`, uses neutral panels
  with color only in chart marks, and shows no chart when the data is
  unavailable; keyboard hints render only for fine pointers; Configurações
  edits frete and alíquota with `MoneyInput` (API keeps dot decimals through
  `toApiDecimal`) and saves through `StickySaveBar`.

### Content rules

- A value appears once per view: no repeated client name, status badge, or
  record link between header, cards, and side panel.
- Every date in a header meta row carries its label (`Data`, `Válido até`,
  `Prazo final`).
- One path per action: an action in the side panel is not repeated in the
  header at the widths where the panel is visible.
- Destructive bulk actions (`Limpar fila`) are quiet icons and always
  confirmed, never a prominent header button.
- Keyboard hints render only for fine pointers.
- Tabs and filter strips fit the width or scroll without a visible scrollbar.
- Missing data stays missing: no fake zero, empty chart, or `—` column.

### Still open

- Surfaces: features still hold hand-built `rounded-card`, raw `<label>` and
  loose `text-xs`/`font-medium`/`uppercase` (ratchets in
  `scripts/check-ui-ratchet.mjs`); each goes to `Card`, `Field`, `Text` or
  `Heading level="eyebrow"`, and becomes a lint ban at zero.
- Breakpoints: desktop layouts start at `lg` wherever they fit; remaining
  `xl:` layouts move as their screens are touched.
- Status labels still written inline (Orçamentos filter, follow-ups, product
  state) move to `lib/statusLabels`.

## Out of scope

This contract does not add a state library or dependency, alter
API/schema/database/auth/integrations, change official calculations, emit
documents, or send messages. Journeys outside the approved slices change only
through the revamp contract above. A later journey must update this document
before changing its normative visual rules.
