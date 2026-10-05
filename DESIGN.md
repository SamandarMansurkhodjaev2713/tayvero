---
name: Tayvero
description: Shared visual system for an open-source CRM and governed agent workspace.
colors:
  primary: "var(--primary)"
  primary-foreground: "var(--primary-foreground)"
  canvas: "var(--background)"
  surface: "var(--card)"
  text: "var(--foreground)"
  subtle-text: "var(--muted-foreground)"
  muted: "var(--muted)"
  border: "var(--border)"
  success: "var(--success)"
  warning: "var(--warning)"
  destructive: "var(--destructive)"
typography:
  title:
    fontFamily: "Geist, sans-serif"
    fontSize: "clamp(26px, 2.2vw, 34px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "14px"
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "13px"
  metric:
    fontFamily: "Geist, sans-serif"
    fontSize: "clamp(24px, 2.2vw, 32px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.04em"
rounded:
  sm: "4px"
  md: "5px"
  lg: "8px"
  xl: "12px"
spacing:
  unit: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "36px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: "36px"
  workspace-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "20px 24px"
---

# Design System: Tayvero

## Overview

The incumbent interface is a restrained operating workspace: a named shell, clear task hierarchy, one metric band and consistent panels for action and evidence. Brand expression comes from typography, controlled density and a selected palette. Public marketing uses a separate editorial composition.

This file is a portable summary. [UI contracts](docs/design.md) contains implementation ownership and responsive detail; [`packages/ui`](packages/ui/src) remains the code source of truth. Frontmatter colors bind to live CSS variables so this summary does not freeze the default theme.

## Colors

Graphite (default), Grove, Sand and Indigo each have light and dark appearances. Primary, surface, text, border and ring adapt together. [`appearance.mjs`](packages/ui/src/theme/appearance.mjs) defines all eight combinations; generated shared CSS applies them.

Use semantic success, warning, destructive, info and severity roles to explain operational state across every palette. Preserve text labels and chart legends. Primary communicates an action or selected route; it does not mean execution succeeded.

## Typography

Geist provides headings, body and controls; Geist Mono handles code and identifiers. Operating titles and metrics use the fluid sizes in frontmatter; panel headings use 15px/600, explanations 13px and details/statuses 12px. Metric numbers use tabular numerals. Keep long explanations readable and allow values and localized copy to wrap.

## Layout

The shared PageShell centers content up to 1280px, uses fluid 16–40px gutters and 24px section gaps. Header, metrics, main work and supporting evidence form the hierarchy. Panels and toolbars shrink and wrap instead of squeezing controls.

At 700px and below, metrics use two columns, panel padding reduces and form controls gain 40px minimum targets with 16px input text. Search takes a usable mobile row. At 1100px, expanded navigation shows labels; compact mode remains available. Wide tables use named focusable scrollers.

## Elevation & Depth

Operating screens separate canvas, card and muted surfaces through tonal layering and borders. Small shared shadows support filled/outline buttons; menus and dialogs use the existing shadow vocabulary. The landing product image has a separate diffuse presentation shadow. Avoid adding decorative floating cards to task screens.

## Shapes

Corners follow the shared scale: small chips (4px), controls (5px), panels and overlays (8px), plus an existing 12px token. Edge-joining elements can remain square. New recurring geometry belongs in shared components.

## Components

Use shared Button, Input, status, table and overlay components. `workspace.tsx` supplies definition-list metrics, titled panels, semantic notices, labeled statuses and wrapping toolbars. Button variants and `wrap` control appearance and long labels; do not restyle their visual identity per page.

Focus uses the selected ring token, and reduced-motion preferences suppress transition/animation durations. Global focus, shared overlay behavior, skip links and text status labels are part of the system.

The public landing's `.tayvero-landing*` CSS is a scoped exception for editorial type, asymmetric layout and larger spacing. It retains shared colors, buttons, focus and truthful preview/readiness copy. Its composition is not the operating-page template.

## Do's and Don'ts

- **Do** extend `packages/ui` for recurring variants and consume generated semantic tokens.
- **Do** keep pending, failed, successful and unknown results distinct, with recovery and coverage context.
- **Do** preserve wrapping search, readable localized text and both density settings.
- **Don't** copy obsolete fallback colors, hardcode a new per-screen palette or recolor semantic states as brand accents.
- **Don't** treat preview images as proof of authenticated operation or claim complete localization, SaaS tenancy or production readiness.
- **Don't** change permission boundaries or default-OFF execution guards as part of visual work.
