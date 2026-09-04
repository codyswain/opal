# Opal design tokens

`src/renderer/styles/index.css` is the token source of truth.
`tailwind.config.js` exposes those values to components. Both light and dark
themes define the same semantic roles independently; a component never chooses
a raw palette shade.

## Color

### Surfaces

| CSS token | Tailwind | Use |
|---|---|---|
| `--canvas` | `bg-canvas` | Window and primary workspace background |
| `--sidebar` | `bg-sidebar` | Persistent navigation |
| `--surface` | `bg-surface` | Panes and ordinary content |
| `--surface-raised` | `bg-surface-raised` | Menus, popovers, floating controls |
| `--surface-hover` | `bg-surface-hover` | Pointer hover |
| `--surface-active` | `bg-surface-active` | Pressed or active control |
| `--surface-selected` | `bg-surface-selected` | Selected row or tile |

### Borders and content

| CSS token | Tailwind | Use |
|---|---|---|
| `--border-subtle` | `border-border-subtle` | Optional visual grouping |
| `--border-default` | `border-border` | Pane and row boundaries |
| `--border-strong` | `border-border-strong` | Inputs and emphasized boundaries |
| `--text-primary` | `text-foreground` | Primary content |
| `--text-secondary` | `text-foreground-secondary` | Supporting text |
| `--text-tertiary` | `text-foreground-tertiary` | De-emphasized metadata |
| `--icon` | `text-icon` | Neutral icons |
| `--focus` | `text-focus`, `ring-focus` | Focus and primary interaction |

Success, warning, danger, and info are semantic state colors. Saturated color
is reserved for state, identity, focus, and a small number of primary actions.
Do not use color as the only state indicator.

The shadcn names (`background`, `card`, `muted`, `accent`, `border`, and
others) remain compatibility aliases while existing components migrate.

## Spacing

Use Tailwind's 4 px base with an 8 px common rhythm.

| Token | px | Use |
|---|---|---|
| `1` | 4 | Icon-to-label gap |
| `2` | 8 | Control padding, tight stacks |
| `3` | 12 | Grid gaps, section padding |
| `4` | 16 | Pane padding |
| `6` | 24 | Empty-state padding |

Avoid arbitrary values such as `p-[7px]`. If a recurring value is missing,
promote it to a named semantic token rather than repeating a literal.

## Typography

The system sans stack is the default. Monospace is reserved for paths,
identifiers, code, and technical values.

| Tailwind | Size / line height | Use |
|---|---|---|
| `text-metadata` | 11 / 14 px | Counts, sizes, timestamps |
| `text-control` | 12 / 16 px | Compact controls and sidebar rows |
| `text-ui` | 13 / 18 px | File names and default desktop UI |
| `text-ui-heading` | 15 / 20 px | Pane and object headings |

Focused document titles may use 22–24 px. Use `font-normal` for content and
`font-medium` for chrome hierarchy. Avoid bold chrome. Use tabular numerals for
sizes, dates, counts, and progress.

## Geometry and density

| CSS token | Tailwind | Default |
|---|---|---|
| `--control-height-compact` | `h-control-compact` | 28 px |
| `--control-height` | `h-control` | 32 px |
| `--row-height-compact` | `h-row-compact` | 28 px |
| `--row-height` | `h-row` | 32 px |
| `--header-height` | `h-header` | 40 px |
| `--sidebar-width` | `w-sidebar` | 220 px |
| `--inspector-width` | `w-inspector` | 336 px |
| `--reading-width` | `max-w-reading` | 720 px |

Rows and controls may use the compact or default value, but features must not
invent their own density scale.

## Icons

Use 14 px icons inside dense rows, 16 px icons in controls, and 32 px icons in
empty states. Icons inherit `currentColor`. Use opacity or semantic content
color for hierarchy instead of feature-specific blue, green, or gray classes.

## Radius and elevation

The shell is flat. Canvas, sidebar, panes, tables, rows at rest, and ordinary
cards have no outer radius or shadow. Structure comes from surface steps,
alignment, and low-contrast borders.

Radius and shadow communicate actual elevation:

| Token / utility | Use |
|---|---|
| `rounded-row` | Dense selected or hovered row |
| `rounded-control` | Buttons and inputs |
| `rounded-overlay shadow-overlay` | Menus and popovers |
| `rounded-dialog shadow-dialog` | Dialogs and Quick Preview |

Do not apply overlay shadows to permanent panes or use large rounded cards as
general page layout.

## Motion

| Token / utility | Duration | Use |
|---|---|---|
| `--duration-hover` / `duration-hover` | 90 ms | Hover, selection, press |
| `--duration-overlay` / `duration-overlay` | 120 ms | Menu and tooltip |
| `--duration-disclosure` / `duration-disclosure` | 150 ms | Sidebar/inspector |

Use `ease-standard`. Never animate ordinary route changes or virtualized row
positions. Motion longer than 200 ms reads as latency in a desktop file app.
The global reduced-motion rule collapses nonessential animation and smooth
scrolling when the OS requests it.

## Theme preference

The user preference is `system`, `light`, or `dark`; renderer components always
apply and report a resolved `light` or `dark` value. The preference lives in
the versioned `opal.theme` envelope. The pre-paint script reads the same schema
before React starts, preventing a theme flash.
