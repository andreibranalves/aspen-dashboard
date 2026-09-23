---
name: Aspen Orçamento
description: "A focused quoting and commercial workspace for Aspen Estamparia."
colors:
  canvas: "rgb(221 221 221)"
  workspace: "rgb(13 13 13)"
  surface: "rgb(20 20 20)"
  surface-raised: "rgb(32 32 32)"
  surface-hover: "rgb(39 39 37)"
  surface-selected: "rgb(52 65 54)"
  border: "rgb(41 41 41)"
  border-control: "rgb(71 71 67)"
  text-primary: "rgb(244 244 242)"
  text-secondary: "rgb(147 147 143)"
  sage: "rgb(127 150 133)"
  light-sage: "rgb(180 198 181)"
  chat-background: "rgb(233 240 233)"
  orange: "rgb(198 135 82)"
  taupe: "rgb(164 147 137)"
  cream: "rgb(241 227 212)"
  rust: "rgb(184 105 87)"
  shell: "rgb(255 255 255)"
  shell-text: "rgb(25 25 25)"
  shell-muted: "rgb(116 119 115)"
typography:
  display:
    fontFamily: "Manrope, Segoe UI, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.22
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Manrope, Segoe UI, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: "Manrope, Segoe UI, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Manrope, Segoe UI, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.33
rounded:
  xs: "4px"
  sm: "11px"
  md: "14px"
  lg: "16px"
  card: "25px"
  shell: "31px"
  control: "11px"
  nav: "14px"
  full: "9999px"
spacing:
  frame: "18px"
  workspace: "24px"
components:
  button-primary:
    backgroundColor: "{colors.light-sage}"
    textColor: "rgb(27 43 32)"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "36px"
  input-default:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "40px"
  nav-active:
    backgroundColor: "{colors.shell-text}"
    textColor: "{colors.shell}"
    typography: "{typography.body}"
    rounded: "{rounded.nav}"
    height: "45px"
  filter-chip-selected:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.workspace}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "36px"
  stat-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "22px"
---

# Design System: Aspen Orçamento

## Overview

**Creative North Star: "The Aspen Workbench"**

Aspen is a focused workbench for one experienced operator. The sketch V01 sets the visual world: a quiet gray outer canvas, a white navigation rail, and a compact dark workspace where quotes, customers, and follow-ups stay in view. Manrope and restrained sage, terracotta, taupe, and cream accents give the operational screens a consistent identity.

Keep the interface dense enough for daily desktop work while making primary actions and status easy to scan. Preserve the sketch's single dark workspace appearance and light sidebar. The product's central task is preparing and sending quotes; visual emphasis should support that work without inventing data or adding explanatory copy that repeats a label.

**Key Characteristics:**
- A white navigation shell surrounds one nearly black workspace.
- Reusable surfaces use tonal contrast and restrained borders.
- Sage marks the main action; warm accents carry status and secondary emphasis.
- Manrope, compact labels, and tabular numerals support operational scanning.

## Colors

The palette pairs a neutral dark workspace with a light navigation shell and a muted botanical accent, with warm colors reserved for status and emphasis.

### Primary
- **Light Aspen Sage** (`colors.light-sage`): primary action fill and accessible focus outline against the dark workspace.
- **Muted Aspen Sage** (`colors.sage`): sidebar action, links, and selected accents.

### Secondary
- **Terracotta** (`colors.orange`): warning and attention status fills.
- **Soft Rust** (`colors.rust`): destructive status fill.

### Tertiary
- **Warm Taupe** (`colors.taupe`): supporting accents.
- **Warm Cream** (`colors.cream`): selected filter chip surface.

### Neutral
- **Outer Canvas** (`colors.canvas`): visible frame around the app shell.
- **Workspace Black** (`colors.workspace`): primary application workspace.
- **Card Charcoal** (`colors.surface`) and **Raised Charcoal** (`colors.surface-raised`): nested surfaces and controls.
- **Primary Ink** (`colors.text-primary`): high-emphasis text on dark surfaces.
- **Muted Ink** (`colors.text-secondary`): supporting text and navigation labels.
- **Navigation White** (`colors.shell`): sidebar surface; shell text and muted text have dedicated tokens.

**The Surface Role Rule.** Use the light shell only for navigation; keep page content on the dark workspace and distinguish nested content with the existing surface levels.

## Typography

Manrope is the application typeface, with Segoe UI and Arial as fallbacks. Use a strong 28px page heading, 16px section titles, 14px working text, and 12px labels. Compact table headings use 10px text; large metrics use tabular numerals. Apply tighter negative tracking only to prominent page headings and large metric values where the components already do so.

**The Scan Rule.** Keep labels compact and values visually prominent; preserve tabular numerals for amounts and counts.

## Layout

The app is desktop-first: a light sidebar sits beside a full-height dark workspace, with an 18px outer frame and 24px workspace padding at desktop widths. The sidebar is 248px at wide desktop, can collapse to 74px, and becomes a 248px overlay on mobile. At compact widths below 1024px it starts collapsed; below 768px it uses the mobile overlay behavior. Keep page content scroll inside the workspace rather than scrolling the whole frame.

Use the existing route structure and shared page primitives. Prefer dense tables and clear working regions; do not force every page into the same card grid when its data is better represented as a list, form, kanban, or editor.

**The Workbench Frame Rule.** Preserve the light outer canvas, separate sidebar, and rounded dark workspace as the shared application frame.

## Elevation & Depth

The workspace is primarily tonal rather than shadow-driven: cards sit one step above the page, and controls sit on a raised charcoal surface. Borders are subtle and close to the surface color. Reserve shadows for overlays such as menus, dialogs, and the mobile sidebar; do not add ambient shadows to ordinary cards.

**The Tonal Depth Rule.** Establish hierarchy with the existing surface colors first; use elevation only when an element overlays other content.

## Shapes

The form language combines a large radius for the application shell and cards with smaller, consistent control and navigation corners. Repeated radii are 4px, 11px, 14px, 16px, 25px, and 31px; full pills are reserved for compact status treatments where used. Controls use a subtle border and a visible sage focus ring. Avoid adding rounded corners to every nested region.

**The Radius Hierarchy Rule.** Keep the shell and major cards visibly softer than controls; use the control and navigation radii for their respective repeated patterns.

## Components

### Buttons
Buttons are compact, confident actions. The primary variant uses sage fill and dark text; secondary uses raised charcoal; outline and ghost variants remain quiet until interaction. Shared buttons use a 36px default height, 11px corners, semibold text, a short color transition, and a visible keyboard focus ring.

### Inputs and Selects
Text inputs and native selects use the raised surface, a subtle control border, 14px text, and 11px corners. Inputs are 40px high. Focus uses a 2px sage ring with a 4px offset; invalid state uses the destructive color. Keep labels, validation, and helper copy with the consuming form.

### Navigation
The sidebar is white with muted gray labels, a black active destination, and a sage primary action. Desktop navigation items have 14px corners and a 45px minimum height. The mobile sidebar is an overlay with a dark backdrop and keyboard dismissal.

### Chips and Status
Filter chips use 11px corners and compact typography; selected filters use cream with dark text. Status badges are compact semantic labels with muted surfaces and status colors. Use full-radius pills only for status and other existing badge patterns.

### Cards and Tables
Cards use the dark surface and 25px corners. The shared metric card uses 22px padding and tabular numerals. Tables remain flat and dense, with subtle horizontal dividers, compact muted headers, and a restrained hover row surface.

### Focus and Motion
Use the existing 2px light-sage focus treatment with a 4px offset on dark surfaces. Buttons transition colors over 150ms; the shared shell transitions sidebar width and transform over 200ms. Honor reduced-motion preferences for animated skeletons.

## Do's and Don'ts

### Do
- Do keep the sidebar white and the workspace dark across application routes.
- Do use the semantic palette and shared controls from `src/components/ui/`.
- Do reserve the sage primary treatment for meaningful actions.
- Do preserve keyboard focus visibility and clear hover or selected states.
- Do keep operational data readable and compact, using tabular numerals for quantities and money.

### Don't
- Don't add a light/dark theme switch; the interface has one appearance.
- Don't invent color, radius, or spacing tokens when an existing token applies.
- Don't add ambient shadows to ordinary cards or stack unnecessary nested panels.
- Don't add helper text that merely repeats a field label or section title.
- Don't turn data tables into decorative cards without a clear interaction reason.
