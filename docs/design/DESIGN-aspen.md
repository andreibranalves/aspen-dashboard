# Aspen UI Design Contract

Status: the only normative Aspen UI document. `DESIGN-supabase.md` is an
aesthetic reference and cannot override Aspen behavior, tokens, routes,
workflows, or accessibility requirements. Journey sections below record
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

Primary blue is an action and selection color, not decoration. Every status
also carries text or an icon; color is never the only signal.

### Typography

Manrope is the product font with `tabular-nums` globally. Monospace is only
for SKUs and identifiers.

Sizes are theme tokens in `src/index.css`; arbitrary `text-[Npx]` is rejected
by lint.

| Role | Class / weight | Where |
| --- | --- | --- |
| Page title | `text-title` 28px / 700 (`text-stat` 22px below `md`) | `PageHeader` only |
| Dialog title | `text-lg` 18px / 700 | `Dialog`, `Drawer` |
| Section title | `text-base` 16px / 600 | top-level cards in a page |
| Sub-section | `text-sm` 14px / 600 | groups inside a section card |
| Body / controls | `text-sm` 14px / 400–600 | text, inputs, selects, buttons |
| Secondary / meta | `text-compact` 13px | page meta, breadcrumb |
| Caption | `text-xs` 12px | field labels, table headers |
| Badge | `text-2xs` 11px / 600 | `StatusBadge`, quality badges, tabs |
| Micro | `text-3xs` 10px | counters, dense captions |

Display numbers use `text-hero` (32px) and `tracking-display`. Elevation uses
`shadow-overlay` (dialogs), `shadow-floating` (popovers) and `shadow-bar`
(bottom action bars).

### Radius roles

`src/index.css` defines the radius roles in `@theme inline` and clears
Tailwind's size scale, so `rounded-md/lg/xl` do not exist. Pick by role:

| Class | Value | Use |
| --- | --- | --- |
| `rounded-xs` | 4px | tiny marks, chart bars, `kbd` |
| `rounded-badge` | 6px | status badges, segmented triggers, menu items |
| `rounded-control` | 11px | buttons, fields, inline alerts, menus, small insets |
| `rounded-nav` | 14px | sidebar items, top search |
| `rounded-card` | 25px | cards, panels, dialogs, drawers |
| `rounded-shell` | 31px | the workspace frame |
| `rounded-full` | — | avatars and icon discs only |

### Focus

One global `:focus-visible` outline (2px, `--focus`, 2px offset). Components
never add their own focus ring. Rows inside clipped containers add
`focus-inset` to draw it inward.

### Controls

Fields, selects and the default button are 40px. Button sizes: `xs` 28, `sm`
32 (dense rows, inline retry), `md` 36, default/`lg` 40, `inline` (no box, for
links in text or tables). `Input` and `Select` take `size` `default` 40, `sm`
32, `xs` 28; `Select size="icon"` is the compact move-to menu. Filled buttons
show a tinted disabled state at full opacity; quiet variants fade.

Appearance comes from props, never from `className` on a `components/ui`
primitive. `eslint.config.js` enforces this with `shadcn/no-restyle`
(`className` may carry layout only, plus the per-component `contracts`) and
`shadcn/no-arbitrary-values`. When a call site needs a new look, add a variant:

| Component | Props |
| --- | --- |
| `Button` | `variant`: `default`, `destructive`, `outline`, `outline-destructive`, `outline-ink` (on colored panels), `secondary`, `soft`, `ghost`, `ghost-muted`, `ghost-destructive`, `link`, `success` |
| `Table` | `density`: `default` (lists), `compact` (documents), `dense` (editable tables in cards); `edges`: `flush`, `inset` |
| `TableRow` | `selected`, `tone="warning"`, `interactive` |
| `Input` | `size`, `hideSpinButtons` |
| `Textarea` | `variant`: `default`, `code`, `bare` (composer inside a bordered box) |
| `StatusBadge` | `status` maps to a tone; `tone` overrides it |

## Layout

`Layout` owns the frame: sidebar, workspace scroll, and the TopBar with the
breadcrumb and global utilities at every width. Pages render inside
`PageShell` (fluid width, 16px rhythm). Nothing in the page is absolutely
positioned against the shell.

`PageHeader` is the first element of every page, in normal flow: optional
`leading` visual, `eyebrow`, the `h1`, optional operational `description`,
a `meta` row (status, revision, dates), and `actions` on the right (secondary
→ primary). Descriptions are context (period, counts), never slogans.

Intentional inner widths stay: Manual and Settings forms cap at 1060px, detail
side panels are 280–336px from `xl`, Auto keeps its two-panel split.

## Components: use X for Y

| Need | Use | Notes |
| --- | --- | --- |
| Modal task or confirmation | `Dialog` / `ConfirmDialog` (`components/ui/dialog`, `shared/ConfirmDialog`) | Radix: Escape, focus trap, restoration; `dismissible={false}` while saving |
| Side panel | `Drawer` / `DetailDrawer` | read-mostly drill-down |
| Sections of a page | `Tabs` + `TabList` + `TabPanel` (`variant="page"`) | or `TabBar` when panels live elsewhere |
| Alternate views/modes | `TabBar variant="segmented"` | Lista/Quadro, Conversa/Manual |
| Search in a list | `SearchField` inside `PageToolbar` | 286px cap |
| Pagination | `ListPagination` | shows `de X` only when the endpoint returns a total |
| Metrics row | `StatCard` in `StatGrid` | pass `loading`; never show 0 before data |
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
Icon-only controls have accessible names. Hover affordances have focus-visible
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
  semantics, source identifiers, and separate billing/delivery PATCH actions.
  Billing and delivery progress stay together with those actions in the 320px
  side panel. Progress styling does not infer new semantic dot states.
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
hierarchy is title/count, status filters with authoritative counts, compact
search, fluid table, and secondary row actions. E-mail delivery remains
available as row context without becoming a primary table column.

The detail keeps the existing draft/revision, emission, PDF, WhatsApp, e-mail,
approval/order, loss, deletion, and history workflows. Issued views follow the
subsequent detail references supplied by the user: client, complete item table
and totals, and commercial conditions appear together without tabs. The client
card retains Ver cliente, Abrir no CRM, and Ver orçamentos anteriores.
Commercial sections respect their saved visibility and titles, using the existing
display-title normalization, and retain their original meanings. Detalhes do
documento and Histórico e revisões use native collapsible sections. Visualizar PDF
and Mais ações remain in the header. Acompanhamento comercial groups delivery
and negotiation actions in a 336px side panel at extra-large widths and stacks
below the content on smaller screens. Draft review and editing
use the same detail shell with totals and consequential emission actions in the
side panel, except that editing recovers the full table width. No business
rule, endpoint, persistence model, or data source is introduced by this visual
slice.

## Approved Novo orçamento entry slice

The new-entry journey uses one page at `#/novo-orcamento` with the existing
`#/auto` and `#/manual` aliases. A segmented mode control under the header
switches between `A partir de uma conversa` and `Preencher manualmente`; both modes share client identity, origin, address,
items, terms, review, and summary state. Desktop uses a main column with a
320px summary/action column for Manual and a two-panel input/result layout for
conversation. Client and address editing use a right-side dialog with Escape,
focus placement, and focus restoration.

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
full-width. The details and evidence are recorded in
`docs/design/evidence/clientes/validacao.md`.

## Out of scope

This contract does not redesign complete feature journeys outside the approved
entry slice, add a state library or dependency, alter API/schema/database/auth/
integrations, change official calculations, emit documents, send messages, or
implement Figma's future navigation map. A later journey must update this
document before changing its normative visual rules.
