# Aspen UI v2 Design Contract

Status: canonical contract for the current Aspen visual foundation and the
Pedidos slice of issue #210. This is the only normative Aspen UI document.
`DESIGN-supabase.md` is an aesthetic reference and cannot override Aspen
behavior, tokens, routes, workflows, or accessibility requirements.

## Source of truth and scope

The visual source is the Figma file
[`N8BOVUvLkQImveVtThA5CV`](https://www.figma.com/design/N8BOVUvLkQImveVtThA5CV),
read from these nodes at implementation time:

- Foundations `5:2` and shared components `6:2`;
- Pedidos list `12:2`, operational detail `12:131`, dark reference `65:21`;
- Export menu `156:207`.

The Figma frames are structural references. The approved behavior in GitHub
issue [#210](https://github.com/andreibranalves/aspen-dashboard/issues/210)
prevails where a sketch is illustrative or conflicts with an existing contract.

This delivery covers the shared shell, shared primitives, and the list/detail
journey for Pedidos. It also applies the shared outer-shell contract to pages
that already consume it. It does not claim that the untouched bodies of
Orçamentos, Clientes, CRM, Dashboard, Catálogo, Envios, Comunicação, or
Configurações match the new journey design. Their routes and workflows remain
available and their body redesigns belong to separate journeys.

## Product character

Aspen is a quiet, precise, operational commercial application. Structure and
meaning come from typography, alignment, spacing, borders, density, and
semantic color. Primary blue is an action and link color, not a decorative
surface or arbitrary badge fill.

## Rendered semantic tokens

The values below are the rendered CSS contract. `src/index.css` stores the RGB
channels; the values below are the resulting hex colors.

### Light theme

| Token              | Value     | Use                                           |
| ------------------ | --------- | --------------------------------------------- |
| `page`             | `#f7f8fa` | application background                        |
| `surface`          | `#ffffff` | cards, controls, panels                       |
| `surface-subtle`   | `#fafafa` | quiet interior surface                        |
| `surface-hover`    | `#f7f7f8` | hover surface                                 |
| `surface-selected` | `#e7f0ff` | selected content rows/controls                |
| `border-subtle`    | `#ededed` | low-emphasis separators                       |
| `border-default`   | `#e2e2e5` | normal borders                                |
| `border-strong`    | `#d1d1d6` | emphasized boundaries                         |
| `border-control`   | `#8a8a92` | input/select boundaries                       |
| `text-primary`     | `#18181b` | primary text                                  |
| `text-secondary`   | `#52525b` | supporting text                               |
| `text-tertiary`    | `#66666f` | metadata and low-emphasis text                |
| `text-disabled`    | `#a1a1aa` | disabled content                              |
| `primary`          | `#165cd8` | actions, focus, active links                  |
| `link`             | `#165cd8` | link text, distinct from surface/action roles |
| `on-primary`       | `#ffffff` | text on primary                               |
| `success`          | `#1a7a4c` | confirmed success                             |
| `warning`          | `#9a5b13` | attention                                     |
| `destructive`      | `#b83a39` | destructive action surface/status             |
| `info`             | `#165cd8` | informational state                           |

### Dark theme

| Token              | Value     | Use                                  |
| ------------------ | --------- | ------------------------------------ |
| `page`             | `#0f1420` | application background               |
| `surface`          | `#141a26` | cards, controls, panels              |
| `surface-subtle`   | `#1a2230` | quiet interior surface               |
| `surface-hover`    | `#202a3a` | hover surface                        |
| `surface-selected` | `#1d2d4a` | selected content rows/controls       |
| `border-subtle`    | `#252f40` | low-emphasis separators              |
| `border-default`   | `#334056` | normal borders                       |
| `border-strong`    | `#46546c` | emphasized boundaries                |
| `border-control`   | `#687991` | input/select boundaries              |
| `text-primary`     | `#ffffff` | primary text                         |
| `text-secondary`   | `#b5bfce` | supporting text                      |
| `text-tertiary`    | `#929eb0` | metadata and low-emphasis text       |
| `text-disabled`    | `#66748a` | disabled content                     |
| `primary`          | `#2f6fdb` | actions and focus                    |
| `link`             | `#8ab4ff` | link text, distinct from action blue |
| `on-primary`       | `#ffffff` | text on primary                      |
| `success`          | `#34c77e` | confirmed success                    |
| `warning`          | `#f0a857` | attention                            |
| `destructive`      | `#e2696a` | destructive action surface/status    |
| `info`             | `#6f9cec` | informational state                  |

The live Figma variable names are preserved semantically: `text/link` maps to
`--link`, `border/control` maps to `--border-control`, and the light Figma
`--text-muted` value `#66666f` maps to `--text-tertiary`. The light metadata
color over `surface-selected` measures 4.95:1; the previous `#71717a` would
measure 4.21:1 and is not used for that context. Text contrast is at least
4.5:1 for normal text and 3:1 for large text, focus indicators, and meaningful
component boundaries. Every status also has text, an icon, or another
non-color signal.

### Shell and action distinctions

The sidebar is navy in both themes and has its own existing compatibility
semantics: `--shell: #0f1420`, `--shell-active: #253040`,
`--shell-text: #f2f5fa`, `--shell-muted: #b5bfce`,
`--shell-hover: #1d2736`, and `--shell-primary: #8ab4ff`. Active navigation uses
`bg-shell-active`, never the pale content `surface-selected`. The collapsed
desktop sidebar is 64px and the expanded sidebar is 216px; navigation targets
remain at least 40px high.

`primary` is the action/focus token. `link` is the text token for links; use
`text-link` for a link even when the link appears in a compact card. Existing
`text-primary` consumers are not renamed globally because that would change
action and status semantics outside this slice. `surface-selected` is for
content selection, not shell navigation.

The destructive action surface uses `destructive`. The shared Button keeps the
verified existing contrast exception `dark:text-page`: light destructive
buttons use white on `#b83a39` (5.67:1), while dark destructive buttons use
`#0f1420` on `#e2696a` (5.66:1). Figma's `destructive/button` is `#b83a39`
with white text; it does not justify removing the existing dark exception
without a new measured dark combination. The same rule applies to the
existing success-button exception. Destructive actions retain secondary-menu
placement where the journey already uses one.

Compatibility aliases remain available while consumers migrate:

| Alias             | Canonical variable |
| ----------------- | ------------------ |
| `--surface-muted` | `--surface-subtle` |
| `--line`          | `--border-default` |
| `--fg`            | `--text-primary`   |
| `--fg-muted`      | `--text-secondary` |
| `--on-solid`      | `--on-primary`     |

Aliases are not renamed for aesthetics and are removed only after a repository
search proves that they have no consumers.

## Typography

Inter is the product font. Shared migrated roles are:

| Role          | Size   | Weight         | Line height |
| ------------- | ------ | -------------- | ----------- |
| Page title    | `24px` | `600`          | `32px`      |
| Section title | `16px` | `600`          | `24px`      |
| UI body       | `14px` | `400`          | `20px`      |
| UI emphasis   | `14px` | `500`          | `20px`      |
| Secondary     | `13px` | `400`          | `18px`      |
| Metadata      | `12px` | `400` to `500` | `16px`      |

Page titles use approximately `-0.2px` letter spacing. Monetary values and
percentages in the Pedidos list/detail use the normal Inter family with
`tabular-nums`; monospace remains for identifiers and SKUs. Local headings in
untouched journeys are not silently reclassified by this contract.

## Layout, spacing, and responsive behavior

`Layout.tsx` owns the application geometry: a 56px top bar, a 216px expanded
sidebar or 64px collapsed desktop sidebar, and main padding of 24px at `md`
and 16px below it. `PageShell.tsx` is the one shared external page container:
it owns `w-full`, the default 16px vertical rhythm, and page animation. It has
no outer max-width. Consumers may override only local rhythm or layout needs
with its existing `className` (for example `space-y-0` for the split Auto
screen or `pb-28` for a bulk bar).

`BulkActionBar` is a fixed viewport overlay, not a second page shell. Its
full-width inner frame uses the same horizontal 16px/24px rhythm and is not
subject to the old 1060px page cap. `PageLoader`, detail skeletons, error
branches, and feature pages use `PageShell` where they represent page content.

The shared spacing scale is `4`, `8`, `12`, `16`, `24`, and `32px`.
Default relationships are an 8px icon gap, 6–8px label/control gap, 12–16px
control gap, 16px section-internal gap, and 24px section gap. Controls are 36px
high; buttons are 28/32/36/40px (`xs`/`sm`/`md`/`lg`). Inputs and selects use a
6px radius; panels and table containers use 8px; dialogs use 12px. Normal
buttons are not pills and default surfaces are flat with a 1px border. Table
headers are 36px to 40px high; rows are 44px to 48px, extending up to 56px
when necessary to show secondary data.

Operational lists are fluid inside `main`, with table overflow contained by
the table primitive when necessary. The list filters keep proportional flex
widths with a 286px desktop ceiling. Intentional inner constraints remain
inside the fluid external shell: the Manual form and Settings form use a
1060px ceiling, and their order/action panels use 320px columns. Auto keeps
its deliberate two-panel split. The Pedidos detail uses a fluid main column
and an intentional 320px side panel from the `xl` breakpoint; the side panel
contains progress and actions together.

Review evidence covers both themes at `1280x800`, `1440x900`, `1024x800`, and
`390x844`. At 1024px the sidebar starts collapsed. Below 768px it becomes an
overlay with Escape/backdrop close and focus restoration. Tables preserve the
primary entity and status, hide only explicitly secondary columns, and scroll
horizontally inside their own wrapper. All interactive targets are at least
24px, with a 32px desktop and 36px narrow-screen target where applicable.

## Component and state rules

Primitives under `src/components/ui/` contain no domain knowledge or API calls.
Shared compositions under `src/components/shared/` own application-wide
patterns. Feature components know their domain. Existing routes, hash query
parameters, endpoints, response fields, permissions, and workflows remain
unchanged.

Use the shared Button, Input, Select, Textarea, Badge, Table, PageHeader,
PageToolbar, PageShell, EmptyState, and existing overlays. Rows that open a
record support keyboard activation and visible focus. Icon-only controls have
accessible names. Hover affordances have focus-visible or persistent keyboard
and touch equivalents. Dialogs support Escape, focus restoration, and focus
containment as already provided by the shared implementation.

Every remotely loaded table has loading, empty, no-results, error, and retry
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
- Pagination shows `Página N` exactly once, with Anterior/Próximo and the
  page-size selector in the footer. It never invents a total count or displays
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
`#/auto` and `#/manual` aliases. Its header owns the WAI-ARIA mode tabs
`Da conversa` and `Manual`; both modes share client identity, origin, address,
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
