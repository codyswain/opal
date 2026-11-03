# Native Context Menus — Design

**Status:** draft, awaiting review
**Follows:** `docs/superpowers/plans/2026-08-17-native-shell-polish.md`, shipped to `dev` in `8b531c1`

## Problem

Every action in `/files` is reachable only from the toolbar, the detail-pane
header, or a keyboard shortcut. Right-clicking a file does nothing. On macOS
that reads as a missing app, not a missing feature: the context menu is where
people expect Reveal in Finder, Rename, Duplicate, and Move to Trash to live,
and it is the only discoverable path to actions that otherwise require knowing a
shortcut.

The one context menu in the codebase (`useFileExplorerContextMenu.ts`,
`FileExplorerContextMenu.tsx`) belongs to `file-explorer-v2`, which is being
retired. It is a reference for the interaction, not code to extend.

Three capability gaps sit behind the menu rather than in it:

- No clipboard IPC, so **Copy Path** cannot be implemented.
- `FileWriter` has no copy operation, so **Duplicate** cannot be implemented.
- Every mutation takes exactly one path, so a menu opened on a five-file
  selection can only act on one of them.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Menu implementation | Electron `Menu.popup` from main | Rows are virtualized `react-window` children; an HTML popup anchored in a row is unmounted on scroll and clipped at the window edge. The OS also supplies blur, keyboard navigation, and submenu timing for free. |
| Dispatch | A target-bound context path, parallel to the app menu | A context action is meaningless without a target. Routing it through `commandRegistry.executeCommand(id)` — which takes no arguments — would require an implicit "current target" global, and would put target-bound items like Rename into the `Cmd+K` palette. |
| Partial failure | Best-effort, per-target results | There is no transaction across files. Reporting "moved 3, 2 failed" is the truth; rollback across a filesystem can itself fail and needs its own failure story. |
| Multi-target | Batch wrappers over the existing single-path methods | Keeps `FileWriter`'s validated single-path core, and its tests, untouched. |

## Architecture

```
RENDERER                                  MAIN
────────────────────────────────          ──────────────────────────────────
useContextMenu.ts        (NEW)            contextMenuTemplate.ts   (NEW, pure)
  onContextMenu handler                     buildContextTemplate(request)
  selection reconciliation                ContextMenu.ts           (NEW)
  sends the request                         popup() + click → send back

contextActions.ts        (NEW)            FileWriter.ts            (MODIFY)
  actionId → function table                 copy()
                                            batch wrappers

diskStore / tabsStore    (MODIFY)         DiskHandlers.ts          (MODIFY)
  closeOthers, closeToRight                 disk:copy, disk:copy-path,
                                            batch mutation channels
```

**Flow.** A right-click builds a `ContextRequest` — the surface kind and the
targets — and sends it over `menu:show-context`. Main builds a template from it
with a pure function, pops the menu at the cursor, and sends the chosen
`{ actionId, targets }` back over `menu:context-invoke`. The renderer looks the
action up in a plain table and calls it with the targets it was given.

The targets travel with the message in both directions. Nothing reads a
"currently right-clicked" global, so a menu can never fire against a file the
user has since navigated away from.

### `contextMenuTemplate.ts` — pure, main

```ts
export type ContextKind = 'entry' | 'tree-item' | 'background' | 'tab';

export interface ContextRequest {
  kind: ContextKind;
  /** Every path the action applies to. Never empty except for 'background'. */
  targets: string[];
  /**
   * Describes the item actually clicked, not the whole selection. Drives item
   * availability: 'Expand' only for directories. Ignored when targets.length
   * exceeds one, where per-item entries are omitted anyway.
   */
  isDirectory?: boolean;
  /** Root paths get Remove Root instead of Move to Trash. */
  isRoot?: boolean;
}

export function buildContextTemplate(request: ContextRequest): MenuTemplateItem[];
```

Reuses `MenuTemplateItem` from `menuTemplate.ts` — a context item is the same
shape as an app-menu item, with `commandId` carrying the action id. No Electron
import, so it unit-tests directly, exactly as `menuTemplate.ts` does.

Labels pluralize against `targets.length`: "Move to Trash" for one, "Move 5
Items to Trash" for many. Items that cannot apply to a multi-selection (Rename,
Open) are omitted when `targets.length > 1` rather than shown disabled — a
greyed item implies "not right now" when the real answer is "not for this
selection".

### `ContextMenu.ts` — main

```ts
export class ContextMenu {
  constructor(deps: {
    menu: MenuLike;              // structural, as AppMenu's — testable
    send: (actionId: string, targets: string[]) => void;
  });
  show(request: ContextRequest, window: BrowserWindowLike): void;
}
```

Mirrors `AppMenu` deliberately: same structural `MenuLike` dependency, same
`toElectronItem` strategy of stripping the internal id and attaching a click
handler. Only `popup()` is new, and only `popup()` is untestable.

### Multi-target mutations

`FileWriter` gains one genuinely new operation and a batch layer:

```ts
copy(target: string, destinationDir: string): Promise<string>;
duplicate(target: string): Promise<string>;   // "name copy.ext", then "name copy 2.ext"

trashMany(targets: string[]): Promise<BatchResult>;
moveMany(targets: string[], destinationDir: string): Promise<BatchResult>;
duplicateMany(targets: string[]): Promise<BatchResult>;
```

```ts
export interface BatchOutcome {
  path: string;
  ok: boolean;
  error?: string;
}
export type BatchResult = BatchOutcome[];
```

Each batch method is a loop over the existing validated single-path method,
collecting outcomes and never throwing. Path validation against `RootRegistry`
stays exactly where it is, so a batch cannot smuggle a path past the guard.

`IPCResponse<BatchResult>` keeps the existing envelope: `success` reports
whether the batch ran at all, `data` reports what each target did. A caller that
ignores `data` sees the same shape it always did.

Duplicate naming follows Finder: `report.pdf` → `report copy.pdf` → `report
copy 2.pdf`. The name generator is pure and lives beside `FileWriter`.

### Clipboard

One new channel, `disk:copy-path`, writing to Electron's `clipboard`. It takes
the target list and joins multiple paths with newlines. Clipboard access stays
in main; the renderer never touches `navigator.clipboard`, which is unreliable
under the app's CSP.

### Store additions

`tabsStore` gains `closeOthers(path)` and `closeToTheRight(path)` — pure state
transitions, unit-tested like the rest of that store.

`diskStore` gains nothing structural. `beginRename`, `beginNewFolder`, and
`beginDelete` already drive the dialogs, so the menu calls them unchanged. The
confirm-delete dialog learns to describe a multi-selection ("Move 5 items to
Trash?") and to report a partial failure.

## Menu contents

**Entry (list row, gallery tile, detail pane)** — Open · Open in New Tab · Quick
Look · — · Reveal in Finder · Open With Default App · — · Rename · Duplicate ·
Copy Path · — · Move to Trash

**Tree item** — Open · Expand/Collapse (directories) · — · New Folder · New File
· — · Reveal in Finder · Copy Path · — · Rename · Move to Trash, or Remove Root
for a root

**Background** — New Folder · New File · — · Sort By ▸ · View As ▸ · — · Reveal
Folder in Finder

**Tab** — Close · Close Others · Close to the Right · Close All · — · Reveal in
Finder · Copy Path

## Selection semantics

Right-clicking an item that is **not** in the current selection selects it first
and acts on it alone. Right-clicking an item that **is** part of a multi-
selection leaves the selection intact and acts on all of it. This is the Finder
rule, and getting it backwards is the fastest way to make someone trash the
wrong files.

The handler calls `event.preventDefault()` — rows are `<button>` elements — and
the menu request carries `data-disk-shortcuts-ignore` semantics so the global
keyboard handler in `DiskExplorer.tsx` does not also fire while a menu is open.

## Error handling

A batch never rejects. The renderer receives per-target outcomes and raises one
toast:

- All succeeded → "Moved 5 items to Trash"
- Some failed → "Moved 3 items to Trash — 2 failed", naming the failures
- All failed → the first error, verbatim

`PathNotAllowedError` on any target is a bug, not a user error, and is logged as
such rather than surfaced as a routine failure.

## Testing

Everything except the popup itself is pure and gets unit tests:

| Unit | What is tested |
|---|---|
| `contextMenuTemplate.ts` | Item sets per kind; multi-select omissions; pluralized labels; root vs non-root; no item without an action id |
| `ContextMenu.ts` | Builds and pops once; click sends `{actionId, targets}`; role items get no click handler |
| `FileWriter` batch + `duplicate` | Per-target outcomes; partial failure; naming collisions; guard still rejects outside-root targets |
| `contextActions.ts` | Every action id in the templates has an entry — a dead menu item becomes a failing test |
| `tabsStore` | `closeOthers`, `closeToTheRight`, and what stays active after each |
| `useContextMenu` | Selection reconciliation: unselected target replaces the selection, selected target preserves it |

**Not tested:** `Menu.popup` rendering, menu appearance, and native keyboard
navigation. The OS draws these and no API reports them. **No E2E test is added**
— the suite holds 9 of its 10 allowed, and that slot is not worth spending on a
menu the harness cannot see.

The "every action id has a handler" test is the important one: it is what stops
this feature's characteristic bug, a menu item that opens, clicks, and does
nothing.

## Out of scope

- **Cut/Copy/Paste of files.** A real clipboard file-transfer story needs
  pasteboard types and cross-app behaviour; Copy Path covers the common case.
- **Undo.** Move to Trash is already recoverable in Finder. A general undo stack
  is its own design.
- **`file-explorer-v2`.** Its context menu stays as-is until that feature is
  retired.
- **Custom submenu content.** Sort By and View As are plain radio submenus; no
  swatches, thumbnails, or previews. If those are ever wanted, they need an HTML
  menu and this design does not preclude adding one later.

## Risks

**An empty submenu hangs startup.** Discovered during the shell-polish work:
`Menu.buildFromTemplate` stalls on a menu whose submenu is empty, which cost an
hour of debugging when the File menu lost its last item. `buildContextTemplate`
must never return an empty array, and the popup path must refuse to show one.
This is a test case, not a comment.

**Multi-select on a large selection.** Trashing 5,000 files is a sequential loop
of IPC-free main-process calls; it will block the main process. The batch layer
should yield between targets, and the toast should appear once at the end rather
than per target.
