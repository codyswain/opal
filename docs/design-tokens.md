# Opal design tokens

`src/renderer/styles/index.css` is the token source of truth.
`tailwind.config.js` exposes those values to components. Both light and dark
themes define the same semantic roles independently; a component never chooses
a raw palette shade. The values follow the design brief drawn from Linear and
Bastion (`docs/product/2026-10-28-pages-first-ux.md`, "Look").

## Layout: chrome, ground and page

Three surfaces, darkest to brightest in light mode (Cody chose option 7 of the
colour sketch on 2026-10-29: option 1, with the top bar in the sidebar's
grey). The chrome colours both sidebars and the 40 px top row, so it runs
down the left, across the top and down the right as one frame. Below the top
row the page column is the ground, a step lighter, and the page sits in it as
a card: 8 px radius, a 1 px hairline ring, inset 8 px on the left, right and
bottom, whether the sidebars are open or not. The ground shows only as that
band. The right sidebar's cards are page-coloured cards on the chrome. There
are no rules between sidebar parts or under the top row; regions are told
apart by the steps between the three greys and by space.

| CSS token | Tailwind | Light | Dark |
|---|---|---|---|
| `--chrome` | `bg-chrome` | #ececec | #0b0b0b |
| `--ground` | `bg-ground` | #f5f5f5 | #131313 |
| `--canvas` | `bg-canvas` | #ffffff | #1a1a1a |
| `--page-ring` | `border-page-ring` | #e2e2e2 | #282828 |
| `--radius-card` | `rounded-card` | 8 px | 8 px |
| `--page-inset` | `m*-page` | 8 px | 8 px |

The Electron window background (`WINDOW_BACKGROUND` in `src/main.ts`) is the
chrome colour, so the first frame matches.

## Color

Black and white only (the spec, "Look"). Every token is a neutral grey from
white to black, including focus, selection and the primary button; the only
colour on screen comes from images inside notes. Emphasis comes from
contrast, weight, size and spacing. Errors and destructive actions use
wording, weight and an icon, never red.

`tailwind.config.js` sets the whole `colors` palette rather than extending
it, so Tailwind's hued defaults (`text-sky-500`, `bg-amber-500`) do not exist,
and its default ring colour is `--focus`. `src/tests/unit/blackAndWhite.test.ts`
fails if a token, a Tailwind colour or a renderer source file brings hue back.

### Surfaces

| CSS token | Tailwind | Use |
|---|---|---|
| `--surface` | `bg-surface` | Content on the page; same as the page |
| `--surface-raised` | `bg-surface-raised` | Menus, popovers, palette, dialogs: #ffffff / #242424 |
| `--surface-sunken` | `bg-surface-sunken` | Code blocks, table heads, wells: #f9f9f9 / #1f1f1f |
| `--surface-lift` | `bg-surface-lift` | The active tab pill, a selected segment: #ffffff / white 10.5% |
| `--surface-hover` | `bg-surface-hover` | Pointer hover: black 4% / white 3% |
| `--surface-active` | `bg-surface-active` | Pressed control: black 7% / white 5% |
| `--surface-selected` | `bg-surface-selected` | Current row or item: black 6.4% / white 7.8% |

The selected overlay is set so a selected sidebar row is #dddddd on the light
chrome and #1e1e1e on the dark one, the sketch's values; on the page it is
#efefef and #2c2c2c. Hover on the chrome is #e3e3e3 / #131313, and on the
page #f5f5f5 / #212121. In dark mode the tab pill is #252525 on the chrome; at
white 10% Chromium renders it a channel off grey, so it is 10.5%.

Hover, active and selected are neutral overlays, not tints. They carry their
own alpha, so they take no Tailwind opacity modifier (`bg-surface-hover/50`
renders nothing). The shadcn alias `muted` points at the solid sunken surface
and does take modifiers.

### Borders and content

| CSS token | Tailwind | Use |
|---|---|---|
| `--border-subtle` | `border-border-subtle` | Hairline inside the page, the page ring (#e2e2e2 / #282828) |
| `--border-default` | `border-border` | Pane and row boundaries (#dcdcdc / #303030) |
| `--border-strong` | `border-border-strong` | Inputs, outline buttons, the hairline between tab pills (#d5d5d5 / #393939) |
| `--border-overlay` | `border-border-overlay` | Menus, popovers, tooltips, dialogs: black or white at 8% |
| `--text-primary` | `text-foreground` | Primary content (#262626 / #ededed) |
| `--text-secondary` | `text-foreground-secondary` | Sidebar rows, supporting text (#3f3f3f / #cbcbcb) |
| `--text-tertiary` | `text-foreground-tertiary` | Labels and metadata; the sketch's muted text (#6b6b6b / #8f8f8f) |
| `--icon` | `text-icon` | Icons and placeholders only (#878787 / #676767) |
| `--focus` | `ring-focus` | Focus ring: dark on light (#666666), light on dark (#b3b3b3) |
| `--primary` | `bg-primary` | The one filled button: near black with white text, inverted in dark mode |

The sketch set the text, muted text, border and selection; the rest are
derived from them. Secondary text is 64% of the text mixed with 36% of the
muted text, and the icon is the lightest grey that keeps 3:1 on the light
chrome.

Contrast, light on white and on the chrome / dark on the page and on the
chrome: primary 15.1 and 12.8 / 14.9 and 16.8; secondary 10.5 and 8.9 / 10.7
and 12.1; tertiary 5.3 and 4.5 / 5.4 and 6.1; icon 3.6 and 3.0 / 3.1 and 3.5;
focus 5.7 and 4.9 / 8.3 and 9.4. Text tokens meet 4.5:1 and the icon and
focus tokens meet 3:1 on both grounds.

Current items and selection use the neutral overlays above. Links in pages
are text-coloured with an underline. Do not use colour as the only state
indicator; there is none to use.

Text selection uses `--selection`: black at 12% in light mode, white at 20%
in dark mode.

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
Recent sits in the page card in a `max-w-reading` column. Its day groups are
`text-label` titles in `text-foreground-tertiary`; its rows are `h-row` with
`rounded-row` and the neutral hover fill, the folder in
`text-foreground-tertiary` and the time right-aligned in `text-metadata`
`tabular-nums`.
Rows and controls may use the compact or default value, but features must not
invent their own density scale.

## Icons

Use 14 px icons inside dense rows and 16 px icons in controls and nav items.
Empty states are one line of `text-ui` in `text-foreground-tertiary`, with at
most one button and no icon. Icons inherit `currentColor` and default to
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

No scroll area shows a thumb at rest. While it scrolls, or while the pointer
is on its scrollbar, the thumb is a 6 px pill 3 px in from the area's outer
edge in `--scrollbar-thumb-hover` (black or white at 20%: #cccccc on the
light page, #484848 on the dark one), and it fades out about a second after
the last scroll (`shared/scrollbars/scrollbarVisibility.ts`).

## Theme preference

The user preference is `system`, `light`, or `dark`, chosen in Settings
(Appearance); renderer components always apply and report a resolved `light`
or `dark` value. The preference lives in the versioned `opal.theme` envelope.
The pre-paint script reads the same schema before React starts, preventing a
theme flash.
