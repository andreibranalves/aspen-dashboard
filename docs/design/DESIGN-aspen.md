# Aspen UI v2 Design Contract

Status: canonical foundation for Aspen UI v2.

This document defines the rules that are normative for Aspen application UI.

The versioned `DESIGN-supabase.md` file in this directory is an aesthetic reference only.

The reference file must not override Aspen's product behavior, colors, typography, information architecture, routes, or accessibility requirements.

## Product character

Aspen is a quiet, precise, operational commercial application.

The interface communicates structure, status, and action through typography, alignment, spacing, borders, density, and hierarchy.

Decoration is allowed only when it improves comprehension or recognition.

Aspen primary blue remains the action color.

Primary blue is used sparingly for primary actions, selected navigation, active or focus states, important links, and occasional chart series.

Primary blue is not a default surface, arbitrary badge fill, or decoration.

## Canonical color tokens

The values below are the rendered contract for both themes.

Implementations may store them as RGB channels or another equivalent CSS representation, but the resulting colors must match these hex values exactly.

### Light theme

| Token | Value |
| --- | --- |
| `page` | `#ffffff` |
| `surface` | `#ffffff` |
| `surface-subtle` | `#fafafa` |
| `surface-hover` | `#f7f7f8` |
| `surface-selected` | `#f4f7fc` |
| `border-subtle` | `#ededed` |
| `border-default` | `#e2e2e5` |
| `border-strong` | `#d1d1d6` |
| `text-primary` | `#18181b` |
| `text-secondary` | `#52525b` |
| `text-tertiary` | `#71717a` |
| `text-disabled` | `#a1a1aa` |
| `primary` | `#165cd8` |
| `on-primary` | `#ffffff` |
| `success` | `#1a7a4c` |
| `warning` | `#9a5b13` |
| `destructive` | `#b83a39` |
| `info` | `#165cd8` |

### Dark theme

| Token | Value |
| --- | --- |
| `page` | `#0f1420` |
| `surface` | `#141a26` |
| `surface-subtle` | `#1a2230` |
| `surface-hover` | `#202a3a` |
| `surface-selected` | `#1d2d4a` |
| `border-subtle` | `#252f40` |
| `border-default` | `#334056` |
| `border-strong` | `#46546c` |
| `text-primary` | `#f2f5fa` |
| `text-secondary` | `#b4bfd0` |
| `text-tertiary` | `#8e9db5` |
| `text-disabled` | `#66748a` |
| `primary` | `#2f6fdb` |
| `on-primary` | `#ffffff` |
| `success` | `#34c77e` |
| `warning` | `#f0a857` |
| `destructive` | `#e2696a` |
| `info` | `#6f9cec` |

Semantic colors communicate meaning rather than decoration.

Every status also includes text, an icon, or another non-color signal.

Normal text meets a minimum WCAG 2.2 AA contrast ratio of 4.5:1.

Large text meets a minimum contrast ratio of 3:1.

Focus indicators and meaningful component boundaries meet a minimum contrast ratio of 3:1 against adjacent colors.

Disabled content remains distinguishable even though it is exempt from normal text contrast requirements.

## Compatibility aliases

The canonical CSS variables are `--page`, `--surface`, `--surface-subtle`, `--surface-hover`, `--surface-selected`, `--border-subtle`, `--border-default`, `--border-strong`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-disabled`, `--primary`, `--on-primary`, `--success`, `--warning`, `--destructive`, and `--info`.

The following aliases remain available while consumers migrate.

| Compatibility alias | Canonical variable |
| --- | --- |
| `--surface-muted` | `--surface-subtle` |
| `--line` | `--border-default` |
| `--fg` | `--text-primary` |
| `--fg-muted` | `--text-secondary` |
| `--on-solid` | `--on-primary` |

An alias is removed only after repository search proves that it has no consumers.

Legacy aliases must not be remapped to unrelated colors.

## Typography

Inter remains the product font for this migration.

| Role | Size | Weight | Line height |
| --- | --- | --- | --- |
| Page title | `20px` | `600` | `28px` |
| Section title | `16px` | `600` | `24px` |
| UI body | `14px` | `400` | `20px` |
| UI emphasis | `14px` | `500` | `20px` |
| Secondary | `13px` | `400` | `18px` |
| Micro or metadata | `12px` | `400` to `500` | `16px` |

Page titles use approximately `-0.2px` letter spacing.

Normal product screens do not use headings of `24px` or larger except for exceptional empty or error states.

Typography establishes hierarchy before color or decoration is introduced.

## Spacing

The shared spacing scale is `2`, `4`, `8`, `12`, `16`, `20`, `24`, and `32` pixels.

The default icon to text gap is `8px`.

The default label to control gap is `6px` to `8px`.

The default control to control gap is `12px` to `16px`.

The default section internal gap is `16px`.

The default section to section gap is `24px`.

The default page horizontal padding is `24px` on desktop and `16px` on narrow screens.

Repeated relationships use repeated values from this scale.

## Radius and elevation

The only custom radius tokens are `xs: 4px`, `sm: 6px`, `md: 8px`, `lg: 12px`, and `full: 9999px`.

Buttons, inputs, and selects use `sm`.

Table containers and small cards use `md`.

Dialogs use `lg`.

Avatars and semantic status badges may use `full`.

Normal buttons do not use pill geometry.

Default surfaces are flat with a one pixel border and no shadow.

Subtle elevation is reserved for separation that a border cannot provide.

Dropdowns, popovers, command menus, and floating panels may use level two elevation.

Modal and critical overlays may use level three elevation.

## Component rules

### Buttons

Button sizes are `xs: 28px`, `sm: 32px`, `md: 36px`, and `lg: 40px` high.

The existing `default` and `success` variants remain public API.

The supported variants are `default`, `secondary`, `outline`, `ghost`, `destructive`, `link`, and `success`.

A page normally has one obvious filled primary action.

Icon-only buttons have accessible names and tooltips when their purpose is not obvious.

### Inputs and forms

The default control height is `36px`.

Inputs use `14px` text, `10px` to `12px` horizontal padding, and a `6px` radius.

Labels use `13px` text at weight `500`.

Helper and error messages use `12px` to `13px` text.

Feature pages use the shared input, select, and textarea primitives instead of hand-styled duplicates.

### Badges

Badges communicate semantic status such as active, archived, issued, paid, pending, lost, or expired.

Badges are compact and share one implementation.

Arbitrary metadata is not rendered as a badge merely for decoration.

### Cards

Content does not receive a card by default.

A card is appropriate for an independently meaningful entity preview, movable item, distinct boundary, or summary.

Nested card containers are avoided.

### Tables

Tables use a `36px` to `40px` header and `44px` to `48px` rows.

Table body text is `14px` and metadata is `12px` to `13px`.

Rows provide hover feedback and clear keyboard behavior when interactive.

The primary entity action is normally the row or entity name.

Destructive actions stay in secondary menus and do not receive equal visual weight.

Every remotely loaded table defines loading, empty, error, and recovery states.

Search, filtering, sorting, and pagination are exposed only when the current endpoint supports them.

## Architecture

Level 1 primitives live under `src/components/ui/` and contain no domain knowledge or API calls.

Level 2 Aspen application compositions live under `src/components/shared/` and contain general application conventions.

Level 3 feature components live under `src/features/<feature>/components/` and may understand their domain.

Existing routes, hash parameters, endpoints, response fields, permissions, and workflows remain unchanged during the visual migration.

The frontend continues to use hash routing and the current application dispatch.

The approved `radix-ui@1.6.7` package is used only for primitives that need its accessibility behavior.

The shadcn initializer is never run against the application.

## Responsive and accessibility requirements

The required review viewports are `1440x900`, `1024x768`, and `390x844` in both themes.

At `1024px`, the sidebar starts collapsed and can be opened without hiding inaccessible content.

Below `768px`, the sidebar becomes an overlay with Escape and backdrop close plus focus restoration.

Tables preserve the primary entity and primary status, hide explicitly named secondary columns, and horizontally scroll when needed.

Kanban boards scroll horizontally and retain keyboard-accessible destination actions.

Dialogs and forms fit the viewport without horizontal page overflow.

Every action is keyboard accessible and has a visible focus state.

Interactive targets are at least `24x24px`, with an Aspen target of `32x32px` on desktop and `36x36px` on narrow screens.

Dismissible overlays support Escape and restore focus to the invoking control.

Modal dialogs trap focus while open.

Hover-only actions also have a focus-visible or persistent keyboard and touch affordance.

## State completeness

Every significant component is reviewed for default, hover, focus, active, selected, disabled, loading, empty, error, success, long-content, and missing-content states as applicable.

Error states explain recovery in Brazilian Portuguese without exposing raw errors or stack traces.

The UI never adds fake buttons, fake tabs, fake charts, fake metrics, or fake activity history.

Missing backend relationships become follow-up issues rather than invented frontend data.

## Scope boundary for Phase 0

Phase 0 versions this contract and the aesthetic reference.

Phase 0 normalizes tokens and audits the shared Button, Input, Badge, and Table primitives.

Phase 0 adds a shared EmptyState composition and a native Select only for existing consumers.

Phase 0 does not redesign feature screens or change routes, workflows, API contracts, or persistence.

Later phases migrate the application shell, customers, CRM, quotations, dashboard, and remaining routes one phase at a time.
