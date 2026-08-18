# Native Shell Polish — Design

**Status:** approved 2026-08-17
**Supersedes:** nothing
**Runs before:** `docs/superpowers/plans/2026-08-17-files-buildout.md`

## Problem

Opal reads as a web app in a frameless window. Three things cause that impression
before a user clicks anything:

1. `src/main.ts:68` sets `frame: false`, and `Navbar.tsx` hand-draws three
   coloured circles in place of the macOS traffic lights. They have no hover
   glyphs, no focus dimming, and no fullscreen or Mission Control behaviour.
2. Nothing in Opal persists to disk. `electron-store` is a dependency that is
   never imported. The window opens at a default size every launch, and
   `ExplorerPanels.tsx:32` holds pane sizes in `useState`, so a resize is lost
   on remount.
3. There is no `Menu` code anywhere in `src/main`. The app ships Electron's
   stock developer menu, so `Cmd+,` does nothing and the Edit menu's clipboard
   roles are absent.

Separately, `/files` has no way to open more than one file, and its sidebar is a
fixed `w-64` div that cannot be resized.

## Scope

**In:** the application shell — window chrome, startup, pane layout and its
persistence, native menus, the shortcut map, performance budgets, and file tabs
in `/files`.

**Out:** `/explorer`'s internal UI, the VFS/notes stack, auto-update, multiple
windows, visual regression tests. `/explorer` receives the shared pane wrapper
and nothing else; it is retired in a later vault slice and must not be polished.

## Relationship to the files build-out

`2026-08-17-files-buildout.md` is written and unexecuted. It builds `/files`
into a real file manager across five phases. This design covers only what that
plan does not, and the two interleave:

| Order | Work |
|---|---|
| 1 | This design, phases 1–3 (chrome, panes, menus/shortcuts/budgets) |
| 2 | Files build-out, phases A–E, unchanged |
| 3 | This design, phase 4 (tabs) |

Phase 4 is last because a tab needs something to render, and the kind-dispatching
`DetailPane` is Task 2 of the files plan. Building tabs earlier would mean
writing a preview host twice and revising a task that is already well specified.

Phases 1–3 land before the files plan because that plan touches
`DiskExplorer.tsx`'s layout in Tasks 2, 7, 12, and 20. Establishing the pane
system first means that layout is written once against its final shape.

## Section 0 — The persistence split

**UI preferences stay in `localStorage`. Window state moves to `electron-store`
in the main process.**

This split is forced by the no-flash budget. Pane sizes, collapse state, open
tabs, and the active theme must be readable *before React's first paint*.
`localStorage` is synchronous and reachable from an inline script in
`index.html`; an IPC round-trip to main is neither, and would reintroduce
precisely the flash this work removes. Window bounds, conversely, must be known
before `BrowserWindow` is constructed, which is before any renderer exists.

The existing `useLocalStorage` hook stays but gains a typed, versioned wrapper
under `src/renderer/shared/prefs/`. Every stored value carries a schema version;
an unrecognised version falls back to the default rather than throwing, so a
schema change cannot brick a user's window on launch.

## Section 1 — Window chrome and startup

`titleBarStyle: 'hiddenInset'` replaces `frame: false`. macOS draws the real
traffic lights; Opal keeps its custom toolbar beside them.

Deleted: the three circle buttons in `Navbar.tsx`, the `system:minimize-window`,
`system:maximize-window`, and `system:close-window` IPC channels, and their
`preload.ts` entries. The IPC contract test will catch any survivor.

The navbar gains a left inset to clear the traffic lights, and
`trafficLightPosition` is tuned once against the 40px toolbar height. The
existing `mt-10` offset on `<main>` in `App.tsx` is replaced by real layout
rather than a magic margin.

Launch sequence:

1. `WindowStateStore` (electron-store) supplies saved bounds, validated against
   the current display list — a window saved on a since-disconnected monitor
   must not open offscreen.
2. `BrowserWindow` is constructed with `show: false` and a `backgroundColor`
   matching the saved theme.
3. An inline script in `index.html` reads the theme from `localStorage` and sets
   `.dark` on `<html>` before any bundle parses.
4. `ready-to-show` reveals the window.

Bounds are written back on debounced `resize` and `move`, plus `close`.

## Section 2 — The pane system

A single module, `src/renderer/shared/components/panes/`, wrapping
`react-resizable-panels`. `PaneGroup` takes a persistence key, restores sizes
and collapse state synchronously on mount, and writes back debounced. Sizes no
longer live in component state, which is what fixes the `ExplorerPanels.tsx`
bug rather than papering over it.

`/explorer` has its existing `PanelGroup` swapped for the wrapper. Its internal
UI is untouched.

`/files` has its fixed `w-64` sidebar replaced by a real pane, and gains a third
pane reserved for the detail view the files plan fills in.

Handles get a 4px visual width with a ~10px grab area, a `col-resize` cursor,
double-click to reset to default, and arrow-key resize when focused.

## Section 3 — Menus, shortcuts, and budgets

A real `Menu.buildFromTemplate` under `src/main/menu/`: App (About, Settings on
`Cmd+,`, Quit), File, Edit, View (theme, pane toggles, reload, zoom), Window.

The Edit menu uses Electron's `role`-based entries. This matters more than it
looks: `Cmd+C`/`V`/`A`/`Z` currently work only by Chromium's default handling
and break inside custom widgets that intercept keys.

**Menu items and the kbar command palette read from one registry.** Today
`App.tsx` registers commands in a `useEffect` and menus do not exist. Letting
the two diverge is how an app ends up with a shortcut that works in the palette
but not from the keyboard. The registry is the single source; the menu template
is generated from it, and each accelerator is declared exactly once.

Budgets, enforced by a `src/tests/perf/` suite using `performance.mark` in the
renderer and `process.hrtime` in main:

| Measure | Budget |
|---|---|
| Cold launch to first meaningful paint | ≤ 400 ms |
| Route switch | ≤ 50 ms |
| 5,000-entry folder listing to painted | ≤ 150 ms |
| Keystroke to paint in search/filter | ≤ 16 ms |

The suite runs in CI and fails on regression. It is not screenshot-based;
`CLAUDE.md` rules that out.

## Section 4 — Tabs (after the files plan)

`tabsStore` holds an ordered list of open paths, an active index, and a single
preview-tab slot.

Behaviour follows Finder and VS Code: single-click replaces the preview tab,
whose title renders italic; double-click or `Cmd+Enter` pins it. `Cmd+1`–`Cmd+9`
select, `Cmd+W` closes, `Cmd+Shift+[` and `]` cycle, and tabs drag to reorder.

The strip renders above the `/files` detail pane, and each tab's body *is* the
`DetailPane` the files plan builds. This phase adds a strip and a store — not a
second preview implementation.

## Testing

Per the policy in `CLAUDE.md`, at the cheapest tier that can fail:

| Subject | Tier |
|---|---|
| Prefs wrapper, versioning, and fallback | unit |
| Bounds validation against display list | unit |
| Command registry and generated menu template | unit |
| Pane persistence and restore | component |
| Tabs store: preview slot, pin, close, reorder | unit |
| Window restores saved bounds and shows without flash | **E2E** |

Exactly one E2E test is added, because window bounds and first-paint behaviour
cannot be verified below a real Electron process. The suite goes from 5 to 6,
inside the ≤10 budget.

## Risks

- **`hiddenInset` alignment.** Traffic-light vertical centring against a 40px
  toolbar needs tuning, and fullscreen transitions must be checked by hand.
  Mitigated by verifying in the running app, not by a test.
- **Deleting the window-control IPC** touches `preload.ts`. The existing IPC
  contract test guards this.
- **The pane wrapper touches `/explorer`.** Its five existing tests must stay
  green; if the wrapper cannot satisfy them, `/explorer` keeps its current
  `PanelGroup` and only `/files` adopts the wrapper.
