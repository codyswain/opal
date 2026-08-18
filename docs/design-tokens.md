# Design tokens — Files

Colour is already defined as HSL CSS variables in `src/renderer/styles/index.css`
(shadcn convention, light and dark). This document covers the rest.

## Spacing — 4px base, 8px rhythm

| Token | px | Use |
|---|---|---|
| `1` | 4 | icon-to-label gap |
| `2` | 8 | control padding, tight stacks |
| `3` | 12 | grid gaps, section padding |
| `4` | 16 | pane padding |
| `6` | 24 | empty-state padding |

Never use arbitrary values (`p-[7px]`, `min-h-[2rem]`). If a value is not on the
scale, the scale is wrong or the design is.

## Type — five steps, no more

| Class | Use |
|---|---|
| `text-[11px]` | metadata, counts, sizes |
| `text-xs` | file names, controls, body of dense UI |
| `text-sm` | pane titles, dialog body |
| `text-base` | dialog titles |
| `text-lg` | empty-state headings |

Weights: `font-normal` for content, `font-medium` for titles. Never `font-bold`
in chrome — weight is for hierarchy, not emphasis.

## Icons

`h-3.5 w-3.5` inside dense rows, `h-4 w-4` for controls, `h-8 w-8` for empty
states. No other sizes.

## Motion

| Token | Duration | Use |
|---|---|---|
| `duration-100` | 100ms | hover, selection |
| `duration-150` | 150ms | dialogs, overlays |

Never longer. Anything over 200ms in a file manager reads as lag, not polish.

## Radius

Inherit from `--radius` (0.5rem) via `rounded-md` / `rounded-lg`. Use
`rounded-sm` for dense rows only.
