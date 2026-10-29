# Opal design tokens

`src/renderer/styles/index.css` is the token source of truth.
`tailwind.config.js` exposes those values to components. Both light and dark
themes define the same semantic roles independently; a component never chooses
a raw palette shade. The values follow the design brief drawn from Linear and
Bastion (`docs/product/2026-10-28-pages-first-ux.md`, "Look").

## Layout: chrome and page

The sidebar and the top row share one chrome ground. The page sits in it as a
card: 8 px radius, a 1 px hairline ring, inset 8 px on the right and bottom
(and on the left when the sidebar is hidden). There are no rules between
sidebar parts or under the top row; regions are told apart by the step from
chrome to page and by space.

| CSS token | Tailwind | Light | Dark |
|---|---|---|---|
| `--chrome` | `bg-chrome` | #f4f4f5 | #08090a |
| `--canvas` | `bg-canvas` | #ffffff | #0f1011 |
| `--page-ring` | `border-page-ring` | #e9e8ea | white at 5% |
| `--radius-card` | `rounded-card` | 8 px | 8 px |
| `--page-inset` | `m*-page` | 8 px | 8 px |

The Electron window background (`WINDOW_BACKGROUND` in `src/main.ts`) is the
chrome color, so the first frame matches.

## Color

### Surfaces

| CSS token | Tailwind | Use |
|---|---|---|
| `--surface` | `bg-surface` | Content on the page; same as the page |
| `--surface-raised` | `bg-surface-raised` | Menus, popovers, palette, dialogs |
| `--surface-sunken` | `bg-surface-sunken` | Code blocks, table heads, wells |
| `--surface-lift` | `bg-surface-lift` | A control raised off a track (selected segment) |
| `--surface-hover` | `bg-surface-hover` | Pointer hover: black 4% / white 3% |
| `--surface-active` | `bg-surface-active` | Pressed control: black 7% / white 4% |
| `--surface-selected` | `bg-surface-selected` | Current row or item: black 7% / white 4% |

Hover, active and selected are neutral overlays, not tints. They carry their
own alpha, so they take no Tailwind opacity modifier (`bg-surface-hover/50`
renders nothing). The shadcn alias `muted` points at the solid sunken surface
and does take modifiers.

### Borders and content

| CSS token | Tailwind | Use |
|---|---|---|
| `--border-subtle` | `border-border-subtle` | Hairline inside the page |
| `--border-default` | `border-border` | Pane and row boundaries |
| `--border-strong` | `border-border-strong` | Inputs and outline buttons |
| `--border-overlay` | `border-border-overlay` | Menus, popovers, tooltips, dialogs: black or white at 8% |
| `--text-primary` | `text-foreground` | Primary content |
| `--text-secondary` | `text-foreground-secondary` | Sidebar rows, supporting text |
| `--text-tertiary` | `text-foreground-tertiary` | Labels and metadata |
| `--icon` | `text-icon` | Icons and placeholders only |
| `--focus` | `ring-focus`, `text-focus` | Focus ring, caret, the primary button (#5e6ad2) |
| `--link` | `text-link` | Links in pages (#5e6ad2 light, #7170ff dark) |

Accent color is for the caret, links, focus and the one primary action. Current
items and selection use the neutral overlays above. Success, warning, danger
and info are state colors only. Do not use color as the only state indicator.

Text selection uses `--selection`; in dark mode the selection is opaque and
its text turns white.

The shadcn names (`background`, `card`, `muted`, `accent`, `border`, and
others) remain compatibility aliases while existing components migrate.

## Spacing

Use Tailwind's 4 px base with an 8 px common rhythm.

| Token | px | Use |
|---|---|---|
| `0.5` | 2 | Gap between sidebar and tree rows |
| `1` | 4 | Icon-to-label gap |
| `2` | 8 | Control padding, tight stacks, page inset |
| `3` | 12 | Grid gaps, space above a sidebar label |
| `4` | 16 | Pane padding |
| `6` | 24 | Section spacing in dialogs |

Avoid arbitrary values such as `p-[7px]`. If a recurring value is missing,
promote it to a named semantic token rather than repeating a literal.

## Typography

The UI font is Inter Variable, bundled through `@fontsource-variable/inter`
(opsz and wght axes), so the app never fetches fonts. The body sets
`font-feature-settings: "cv01", "ss03"` and `font-optical-sizing: auto`.
Monospace is `ui-monospace`, SF Mono, Menlo.

| Tailwind | Size / line height | Use |
|---|---|---|
| `text-metadata` | 11 / 14 px | Counts, sizes, kbd hints |
| `text-label` | 12 / 16 px, weight 510 | Section and group labels |
| `text-control` | 12 / 16 px | Dense secondary controls |
| `text-ui` | 13 / 18 px, -0.01em | Rows, menus, buttons, default UI |
| `text-ui-heading` | 15 / 20 px | Dialog and pane headings |

Weights come from Inter's variable axis: 400 regular, `font-medium` 510 for
nav items, active rows and buttons, `font-semibold` 590. Tree rows stay at 400.

Labels are sentence case. Never uppercase a label or widen its letter spacing.

Use `tabular-nums` for dates, times, sizes and counts.

`cn()` knows these size names, so `cn('text-ui', 'text-foreground')` keeps
both classes.

## Geometry and density

| CSS token | Tailwind | Default |
|---|---|---|
| `--control-height-compact` | `h-control-compact` | 28 px |
| `--control-height` | `h-control` | 32 px |
| `--row-height-compact` | `h-row-compact` | 28 px |
| `--row-height` | `h-row` | 32 px |
| `--header-height` | `h-header` | 40 px |
| `--sidebar-width` | `w-sidebar` | 260 px |
| `--reading-width` | `max-w-reading` | 720 px |

Sidebar and tree rows are 28 px tall with a 6 px radius and 2 px between rows.
The tree indents 16 px per level; a folder's chevron sits where a nav icon
does, so top-level labels line up with Today and Recent.

The page column's top row is one `h-header` row: tab pills, New tab, and a
200 px search field. Pills are `h-control-compact` with `rounded-control`,
96 to 200 px wide, `text-ui`; the active pill is `bg-surface-lift` with
`shadow-control` at weight 510, the others take `bg-surface-hover` on hover.
Same-name tabs add their folder in `text-foreground-tertiary`. The search
field is `bg-surface-hover` and stays centred in the row until the tabs need
the room.
Rows and controls may use the compact or default value, but features must not
invent their own density scale.

## Icons

Use 14 px icons inside dense rows, 16 px icons in controls and nav items, and
32 px icons in empty states. Icons inherit `currentColor` and default to
`text-icon`. Use opacity or semantic content color for hierarchy instead of
feature-specific blue, green, or gray classes.

## Radius and elevation

Radius and shadow communicate actual elevation. The page card has a ring, not
a shadow; a shadow means a thing floats.

| Token / utility | Value | Use |
|---|---|---|
| `rounded-sm` | 4 px | Kbd, chips, checkboxes |
| `rounded-row` | 6 px | Sidebar and tree rows, menu items |
| `rounded-control` | 6 px | Buttons and inputs |
| `rounded-card` | 8 px | The page card |
| `rounded-overlay shadow-overlay` | 8 px | Menus and popovers |
| `rounded-dialog shadow-dialog` | 12 px | Dialogs and the palette |
| `shadow-control` | | A lifted control on a track |

## Motion

| Token / utility | Duration | Use |
|---|---|---|
| `transition-hover` | 0 ms in, 150 ms out | Hover fill on rows, buttons, menu items |
| `--duration-quick` / `duration-quick` | 100 ms | Chevron rotation, small state changes |
| `--duration-overlay` / `duration-overlay` | 160 ms | Menus, popovers, dialogs |
| `--duration-disclosure` / `duration-disclosure` | 200 ms | Sidebar show and hide |

`transition-hover` makes the hover fill appear at once and fade out when the
pointer leaves. Menu items add `focus:duration-0`, because their highlight
follows focus. Use `ease-standard` (ease-out quad) by default and
`ease-emphasized` for the sidebar and palette. Never animate ordinary route
changes or virtualized row positions. The global reduced-motion rule collapses
nonessential animation and smooth scrolling when the OS requests it.

## Scrollbars

Scrollbars are 6 px with a translucent thumb (`--scrollbar-thumb`). Inside an
element with `scrollbar-on-hover`, such as the sidebar, the thumb is
transparent at rest and shows only while the pointer is over it. It uses the
standard `scrollbar-color`, so with macOS overlay scrollbars it also follows
the system and appears while scrolling.

## Theme preference

The user preference is `system`, `light`, or `dark`, chosen in Settings
(Appearance); renderer components always apply and report a resolved `light`
or `dark` value. The preference lives in the versioned `opal.theme` envelope.
The pre-paint script reads the same schema before React starts, preventing a
theme flash.
