# Linear-Inspired Opal UX — Design Audit and Direction

**Date:** 2026-09-04
**Status:** Proposed
**Scope:** Opal's global shell and `/files` experience. The legacy `/explorer`
route remains available during migration but does not receive another standalone
visual polish pass.

## Inputs

- User-supplied recording: `~/Desktop/linear.mov`
  - 42.58 seconds
  - 3418 × 1896
  - 60 fps
- Current Opal inspected in a real Electron window at 1440 × 900 in both
  `/files` and `/explorer`.
- Current renderer architecture, stores, shared components, design tokens,
  tests, and the native-shell/context-menu plans.
- Linear's public documentation for
  [Display options](https://linear.app/docs/display-options),
  [Filters](https://linear.app/docs/filters), and
  [Search](https://linear.app/docs/search).

The recording was sampled at one frame per second for state analysis and ten
frames per second around navigation, popover, inspector, and scrolling
transitions. Timestamps below are approximate because the source is an edited
walkthrough rather than a scripted benchmark.

The timestamped audit in this document is the portable fallback when the local
recording is unavailable. The recording is reference material, not a build
dependency.

---

## Executive finding

Opal is already superficially near Linear: dark surfaces, small icons, thin
borders, a native title bar, resizable panes, and compact text are present.
Changing the gray values or rounding a few controls will not close the quality
gap.

The important difference is the interaction architecture:

> **Linear has one stable application frame, a contextual working surface, and
> progressively disclosed controls. Opal has a global tool strip, three
> permanent panes, and several different concepts coupled to one selection
> value.**

Linear feels calm despite showing more information because:

1. Navigation stays spatially stable while only the work surface changes.
2. Every screen has a clear primary object and a small number of contextual
   controls.
3. Dense rows align metadata instead of wrapping it in cards.
4. Secondary information appears in an inspector, split view, popover, or hover
   state only when useful.
5. Route changes are nearly immediate and page-level animation is restrained.
6. Keyboard and pointer paths operate on the same commands.

Opal's redesign therefore starts with shell and state semantics, then applies a
coherent visual system. A CSS-only pass would preserve the behaviors that
currently make the product feel less deliberate.

---

## What the Linear recording shows

### Timestamped walkthrough

| Time | Observed state or interaction | Why it feels deliberate |
|---|---|---|
| 00:00–00:01 | A native macOS file chooser floats over an issue board. | OS-owned work uses an OS-owned surface; the application remains visibly present behind it. |
| 00:01–00:04 | Full issue board with a persistent left sidebar, a breadcrumb header, grouped columns, compact cards, and an optional right facet panel. | A large amount of data is made scannable through alignment, muted chrome, sticky group labels, and small semantic color marks. |
| 00:04–00:06 | Inbox opens. A narrow notification list appears between the unchanged sidebar and a quiet empty detail surface. | Navigation changes only the center grid. The user's spatial model is preserved. |
| 00:06–00:08 | Selecting an inbox item fills the detail surface while the list remains visible. | Selection reveals context without navigating the user away from the queue. |
| 00:08–00:11 | A favorite issue opens as a focused page. The sidebar remains; the list disappears; content and a metadata rail share the main surface. | The same object has a peek mode and a focus mode rather than one compromise layout. |
| 00:11–00:15 | The sidebar scrolls independently and switches between team homes. | Navigation density is handled with hierarchy and independent scrolling, not wider rows or global page scrolling. |
| 00:11–00:20 | Team overview pages reuse the same shell, local tabs, centered content region, and contextual links/members rail. | Repeated structure teaches the product once. Empty content does not introduce a special layout. |
| 00:20–00:22 | Projects opens as a full-width, dense table with aligned health, priority, lead, date, count, and progress columns. | Structured data uses rows and columns, not cards. Color is reserved for state. |
| 00:22–00:25 | A project opens into a focused overview, then its Issues sub-tab opens a grouped issue list. | The page header identifies the object; local tabs change facets of that object without changing the global shell. |
| 00:25–00:27 | A filter button opens a compact anchored menu; hovering Status opens a nested value menu. | Complex capability is one click or one `F` shortcut away but absent at rest. |
| 00:27–00:30 | Display options opens with a List/Board segmented control, grouping, ordering, toggles, and property chips. | Presentation is treated as a coherent configuration surface, not a row of unrelated toolbar buttons. |
| 00:29–00:32 | A right analysis/properties panel opens, first with a contained loading state and then with real content. | The list does not navigate away. The secondary panel has its own stable width and scroll region. |
| 00:32–00:38 | The user returns to Inbox, then moves through Projects, Views, and Loops. | Fast route changes and a fixed frame make broad navigation feel cheap. |
| 00:38–00:42 | A long issue detail scrolls through prose, code blocks, metadata, and activity while the global sidebar and right property rail stay fixed. | Content owns the scroll. Context remains available. |
| 00:42–end | Activity entries and inline reply composers appear at the end of the detail. | History is chronological and low-chrome; actions live beside the content they affect. |

### Motion finding

The recording does not show elaborate page transitions. Most route and selection
changes resolve within one or two 100 ms samples. Popovers use a subtle
fade/scale treatment; content scrolling is direct; the application avoids
animating large surfaces merely to advertise that navigation happened.

Linear's perceived speed comes more from stable geometry, cached state, and
immediate feedback than from motion. Opal should not add a general animation
library to imitate "polish." CSS transitions on overlays, hover, selection, and
pane disclosure are enough.

---

## Component-by-component comparison

### 1. Application frame

**Linear**

- One left application sidebar.
- One 40-ish-pixel top context bar over the working surface.
- Main content changes within that frame.
- Optional list, detail, or inspector columns are contextual.

**Opal now**

- `App.tsx` renders a fixed global `Navbar` and offsets `<main>` with `mt-10`.
- The navbar's center contains a product-level `Explorer` / `Files` switch.
- `/files` then renders another three-pane application inside the global frame.
- The right pane is always allocated, even when it can only say "Select a file."

**Target**

- Replace `Navbar` with a true `AppShell`.
- The title-bar row is split between workspace identity/sidebar actions and the
  current page's breadcrumb/actions.
- Secondary panes are conditional and restore their state before first paint.
- React Router remains the authority for top-level route history. The shell does
  not introduce a competing navigation stack.

### 2. Workspace sidebar

**Linear**

- Workspace switcher, search/new affordances, primary destinations, favorites,
  and expandable team-local navigation share one hierarchy.
- Section labels are quiet; rows are approximately 28–30 px high.
- Counts and status marks align at the trailing edge.
- The sidebar scrolls independently and can collapse.

**Opal now**

- The global navbar carries route selection.
- `/files` has a separate pane labeled `FILES` containing only a raw directory
  tree.
- `/explorer` has another unrelated Files sidebar.
- There is no unified place for roots, recents, favorites, search, notes, or
  settings.

**Target**

- Workspace header: Opal identity plus current-root/workspace chooser.
- Primary destinations backed by real behavior: Notes and Files.
- Open roots section containing the existing lazy directory tree.
- The tree shows directories, not every file in an expanded 5,000-item folder,
  and uses a flattened virtualized model if the visible directory count is
  large.
- Notes remains available under the stable shell until on-disk markdown editing
  moves into `/files`; its implementation may be legacy without presenting the
  user's core note capability as deprecated.
- Settings and account/theme actions move to the sidebar footer or command
  menu, not permanent title-bar icons.
- Recent and Favorites appear only after their real stores ship.
- Workspace search appears only when a real index/search slice exists. The
  Command Menu is an action launcher, not mislabeled search.
- Do not render speculative Agent, activity, collaboration, or collection
  destinations until they have working models.

### 3. Context header and breadcrumbs

**Linear**

- The header names the current scope with a compact breadcrumb.
- Favorite and overflow actions sit beside the title.
- Filter, display, analysis, and panel controls align at the far right.
- A second row appears only for object-local tabs.

**Opal now**

- Back/forward buttons read the legacy `fileExplorerStore`, even on `/files`.
- The center of the global bar is a route switch.
- `/files` adds a breadcrumb row, a crowded toolbar, then an item-count/view row.
- Including the global navbar, a directory can therefore spend three rows on
  chrome before content begins.

**Target**

- One `WorkspaceHeader` per route, rendered into the shell.
- Left: universal back/forward, breadcrumb, overflow, and favorite only after
  the Favorites feature exists.
- Right: search-in-view, filter, display options, inspector toggle, and one
  primary creation action when relevant.
- At rest, a directory uses one header row plus an optional active-filter row.
- Back/forward operates on the active Opal location model, never a feature-
  specific legacy store.

### 4. Local tabs

**Linear**

- Team and project pages use small semantic tabs such as Overview, Activity,
  Issues, Documents, or Members.
- Tabs switch facets of one object.

**Opal now**

- `TabStrip` is an editor-style file tab strip placed above the narrow right
  preview pane.
- Merely selecting a file creates or replaces a preview tab.
- The tab's content and the grid selection can disagree.

**Target**

- Selection never creates a tab.
- Single click selects and updates the inspector only when the user has chosen
  to keep that inspector open.
- Double click or the explicit Open command moves the item into the main focus
  surface and opens/pins it.
- File tabs live over the main focus surface and represent genuinely opened
  files. The current preview-tab state is retired during this redesign rather
  than assigned a second ambiguous trigger.
- Semantic object tabs (Preview, Properties, Backlinks, Activity) are separate
  from open-file tabs and appear only when those facets exist.

### 5. Dense list and table rows

**Linear**

- Rows use a consistent baseline, leading icon/state, primary label, and
  trailing aligned metadata.
- Headers and groups are sticky and subdued.
- Hover reveals checkboxes or secondary actions.
- Selection is visible but not dramatically brighter than hover.

**Opal now**

- List rows are fixed at 40 px and show only icon, name, and size.
- The selected row is a comparatively strong full-width gray slab.
- All sort fields are permanent toolbar buttons.
- Clicking a folder changes the current directory immediately because
  `selectedPath` also determines `activeDirectory`.

**Target**

- Default row height 32–34 px, with an optional 28–30 px compact mode.
- Real columns: Name, Modified, Kind, and Size; columns can be shown or hidden.
- The detailed list is the file table; Opal does not ship separate List and
  Table modes that differ only cosmetically.
- Directories and files remain in a single virtualized list.
- Selection, current directory, keyboard focus, and opened item become separate
  state.
- Single click selects. Double click opens/navigates. Finder-compatible keyboard
  behavior remains: Return renames; `Cmd+Down` opens; Space invokes Quick
  Preview.

### 6. Board and gallery

**Linear**

- Board and list are alternate views over the same typed objects and properties.
- Grouping, sub-grouping, ordering, and visible fields are configured in one
  Display options surface.

**Opal now**

- Gallery/list mode is local React state.
- The initial mode is guessed from image ratio and explicit changes are not
  durable per directory.
- Gallery is a valid file-specific view, but there is no metadata model that
  makes a Linear-style board meaningful yet.

**Target**

- Details and gallery share one persisted `DirectoryViewConfig`.
- Initial Display options owns layout, density, ordering, folders-first, and
  visible columns.
- Grouping joins that surface only when authored metadata makes it meaningful.
- Board is intentionally deferred until authored properties/sidecars exist.
  Fake columns based only on file extensions would look like Linear without
  delivering Linear's utility.

### 7. Split view / peek

**Linear**

- Inbox keeps the queue visible while selection fills a larger detail pane.
- The empty detail state is quiet and centered.
- Opening the object directly changes to a focus layout.

**Opal now**

- Every directory is permanently split into tree, listing, and preview.
- The preview often receives too little width for markdown or media.
- A large empty preview remains visible before selection.

**Target**

- Browse: sidebar + directory surface, with inspector closed.
- Peek: sidebar + directory surface + contextual preview/metadata inspector.
- Focus: sidebar + primary file/document surface + optional metadata rail.
- These are explicit layout modes, not incidental combinations of selections.
- At narrower widths, peek/inspector becomes an overlay rather than crushing the
  primary content.

### 8. Focused detail surface

**Linear**

- Long-form content has a readable measure.
- The object title and key properties establish hierarchy before the body.
- Metadata is either a compact inline strip or a stable right rail.
- Activity follows the content rather than competing with it.

**Opal now**

- Markdown is rendered inside the narrow right pane.
- Typography-plugin defaults produce oversized headings relative to the shell.
- File actions live in a separate pane header, while path and metadata are
  sparse.

**Target**

- A focused file opens in the main surface.
- Markdown uses a 680–760 px reading measure and a dedicated compact prose
  scale, not generic Tailwind typography defaults.
- Header: filename, path/breadcrumb, favorite, and overflow.
- Inline property strip starts with real file facts: kind, size, modified date,
  dimensions/duration when available.
- The right rail adds only real capabilities—properties, backlinks, versions,
  or activity as those systems ship.

### 9. Inspector

**Linear**

- The right panel is optional, contextual, independently scrollable, and
  switchable between analysis/properties.
- It has contained loading and empty states.

**Opal now**

- The detail pane is structurally mandatory.
- Its width is persisted, but its visibility is not connected to the global
  right-pane toggle.
- `isRightSidebarOpen` changes `/explorer` only; on `/files` the toolbar button
  and native menu communicate a state change that the user cannot see.

**Target**

- One shell-level inspector contract used by routes.
- The `/files` inspector supplies preview, metadata, or multi-selection summary.
- `Cmd+Alt+B`, the native menu, and the title-bar control all toggle the same
  state.
- Width, open/closed state, and last selected inspector tab persist
  synchronously.

### 10. Filter and display controls

**Linear**

- `F` opens a searchable filter menu.
- `Shift+V` opens display options.
- `Cmd+F` exposes temporary search within the current view.
- Active filters remain legible, while inactive machinery is hidden.

**Opal now**

- Filter input, density toggle, "Sort" label, four sort buttons, and two layout
  buttons all occupy permanent chrome.
- View mode is separated from sort and density even though they configure the
  same surface.

**Target**

- Search icon or `Cmd+F` expands a compact in-view field; Escape clears/closes.
- Filter opens an anchored menu and active filters appear as removable chips.
- Display options contains layout, density, sort field/direction, folders-first,
  and visible columns.
- Rich configuration uses a renderer popover; OS-native context menus remain
  reserved for target-bound file actions.

### 11. Popovers, menus, dialogs, and command menu

**Linear**

- Floating surfaces are the place where radius and shadow become noticeable.
- Menus are dense, searchable where necessary, and expose shortcuts.
- The command/search surfaces are first-class navigation tools.

**Opal now**

- `DropdownMenu` is a reasonable Radix base, but visual values are generic.
- `KBar` hard-codes white, gray, black, and bright blue instead of theme tokens.
- Dialogs are handmade, without a shared focus/portal contract.
- Settings still uses `window.confirm`.
- The app has both an old HTML context menu and a planned native `/files`
  context menu.

**Target**

- A small primitive set: `IconButton`, `Tooltip`, `Menu`, `Popover`, `Dialog`,
  `SegmentedControl`, `Switch`, `Chip`, `Kbd`, `Badge`, and `EmptyState`.
- One tokenized Command Menu with grouped navigation, recent files, commands,
  and visible shortcuts.
- Native Electron context menus for file/tree/tab targets, following the
  existing context-menu design.
- Renderer popovers for filter/display controls because they contain richer
  interactive content than a native menu supports.

### 12. Empty, loading, error, and activity states

**Linear**

- Empty states are icon + one short sentence, centered in the available pane.
- Loading is contained to the surface being updated.
- Activity is a quiet chronological stream with inline reply affordances.

**Opal now**

- `/files` has a good reusable `EmptyState`, but descriptions are often longer
  than the task requires.
- Gallery has a skeleton; other surfaces do not share one loading grammar.
- Errors appear both as a toast and a persistent banner, producing duplicate
  feedback.
- Activity/version history is not yet a real data capability.

**Target**

- Empty state copy is one title, one optional line, and one action.
- Skeletons preserve the geometry of list, preview, inspector, and document
  surfaces independently.
- One error policy decides inline versus toast; the same failure is never shown
  twice.
- Activity UI waits for real file-version, link, or annotation events.

---

## Current structural blockers

These must be corrected for the visual redesign to hold together:

1. **Selection is overloaded.** `selectedPath` acts as tree selection, current
   directory, list focus, preview target, rename target, and tab-opening input.
2. **Folder selection is navigation.** Selecting a directory in the list
   immediately replaces the listing, making ordinary selection and
   multi-selection fragile.
3. **Preview creates navigation state.** A single click automatically mutates
   `tabsStore`.
4. **Global pane commands are dishonest on `/files`.** The preferences and
   title-bar icons do not control `DiskExplorer`'s pane group.
5. **Back/forward is feature-specific.** `Navbar` reads only the legacy
   explorer's history.
6. **View configuration is transient and global.** Layout is component-local;
   sort/filter/density are global instead of per directory/view.
7. **Two product shells coexist.** `/explorer` and `/files` use unrelated
   navigation, sidebars, detail semantics, and styling.
8. **Keyboard behavior is scattered.** Several components install independent
   global `keydown` listeners with their own focus guards.
9. **The visual token layer is too coarse.** `background`, `card`, `muted`,
   `accent`, and one `border` cannot describe canvas/sidebar/panel/elevation or
   hover/active/selected/focus states precisely. KBar and parts of Notes bypass
   even those tokens, while an unused styled-components layer remains in the
   repository.
10. **Path identity is not coordinated.** Rename, move, root removal, and
    external deletion can invalidate tabs, selection, view preferences,
    inspector, history, recents, and favorites independently.
11. **The sidebar tree renders files recursively.** Expanding a very large
    directory can bypass the virtualization used by the main directory view.

---

## Target product model

### The three workspace modes

#### Browse

```
┌──────── Sidebar ────────┬──────────── Directory / collection ─────────────┐
│ workspace + navigation │ header, filters, display options                │
│ roots + lazy tree      │ dense details / gallery                         │
└─────────────────────────┴──────────────────────────────────────────────────┘
```

The inspector is closed by default. The content surface receives the space.

#### Peek

```
┌──────── Sidebar ────────┬──────── Directory ───────┬──── Inspector ───────┐
│ stable navigation      │ selection remains visible │ preview + file facts │
└─────────────────────────┴────────────────────────────┴──────────────────────┘
```

Peek is selection context, not an opened document and not a new tab.

#### Focus

```
┌──────── Sidebar ────────┬──────── Focused file / document ──┬─ Metadata ──┐
│ stable navigation      │ readable primary surface           │ optional    │
└─────────────────────────┴────────────────────────────────────┴─────────────┘
```

Focus is entered by explicit open behavior. The directory location remains in
history, so Back returns to the prior selection and scroll position.

### State vocabulary

The renderer needs separate values for:

- `currentDirectory`: the directory whose children are visible.
- `selectedPaths`: the current list/tree selection.
- `focusedPath`: the selection anchor and keyboard cursor.
- `openedPath`: the item occupying the focus surface.
- `quickPreviewPath`: the temporary app-rendered preview target.
- `inspector`: open/closed, width, and active tab.
- `viewConfig[directory]`: layout, density, sort, visible columns, and filters.
- `filesLocation`: a normalized browse/focus location represented through React
  Router state/search params. Selection and scroll restoration belong to a
  non-routing snapshot keyed to the current router location; they never create
  history entries. There is no second shell-owned route stack.

Names may change during implementation; the separation may not.

### Information architecture

The initial sidebar ships only destinations backed by behavior:

1. Notes
2. Files
3. Open folders / roots with the lazy, directory-only tree
4. Settings in the footer

Recent and Favorites join this list when their stores ship. Workspace search is
a separate future capability gated by the real index; until then, Opal exposes
the Command Menu and in-view file filtering without claiming either searches
all content.

Future metadata-backed features—saved views, collections, boards, graph,
backlinks, and Agent—fit this hierarchy later. They should not be represented by
dead navigation rows during the visual pass.

### Interaction matrix

The redesign uses this exact baseline contract:

| Target/action | Single click | Double click | Return | `Cmd+Down` | Space |
|---|---|---|---|---|---|
| File row/tile | Select only | Open in Focus and add a real tab | Rename | Open in Focus and add a real tab | Open app-rendered Quick Preview |
| Folder row/tile | Select only | Navigate into folder | Rename | Navigate into folder | No action |
| Sidebar directory | Navigate/select directory | Same as single click | No rename from navigation row | Navigate | No action |
| Open-file tab | Activate focused file | Same as single click | No action | No action | No action |

The focused sidebar tree and directory collection provide buffered typeahead
over visible item labels. Printable keys are never intercepted from an input,
menu, dialog, editor, or other text-entry surface.

Inspector behavior is also explicit:

- It is closed by default for a new wide-layout user.
- Selection never forces it open or changes layout geometry.
- When the user opens it, it follows the current selection and its state
  persists.
- Closing it remains respected across selection changes.
- A pinned inspector with no valid selection shows a compact explanation rather
  than silently reopening or consuming a third of the window without purpose.

The existing renderer modal called Quick Look is renamed **Quick Preview** in
user-facing UI. It is not native macOS Quick Look. It is modeless with respect
to list navigation: Escape closes it, while arrowing can change the selected
preview target.

Router mutation semantics are fixed:

| Event | History behavior |
|---|---|
| Navigate into another directory | Push |
| Open a file in Focus | Push |
| Browser/shell Back or Forward | Traverse existing entries |
| Select, range-select, filter, sort, resize, or scroll | No route mutation; update current-location snapshot/preferences |
| Canonicalize an invalid route or fall back after deletion/root removal | Replace |
| Remap the current path after an app-initiated rename/move | Replace current entry; remap stored snapshots without adding history |

### Path identity and mutation

App-initiated rename/move operations produce an exact old→new path mapping.
One coordinator applies that mapping atomically to current directory, subtree
listings, selection, tabs, router location, inspector, view preferences,
recents, and favorites.

External watcher events do not currently provide enough identity information to
prove that an unlink/add pair is a rename. Until content-hash identity lands,
external removals clear or close stale UI state and external additions appear as
new paths. Opal must not guess and attach old authored state to the wrong file.

Per-directory display preferences live in one capped, versioned map rather than
one unbounded localStorage key per absolute path. Use root-relative keys inside
each root record, remap subtrees on app-initiated moves, purge a removed root,
evict least-recently-used entries beyond a fixed cap, and treat quota failure as
cosmetic rather than a boot failure.

---

## Visual system

The values below are target rules, not a requirement to copy Linear's exact
pixels or brand.

### Color

Expand the semantic token set:

- `canvas`
- `sidebar`
- `surface`
- `surface-raised`
- `surface-hover`
- `surface-active`
- `surface-selected`
- `border-subtle`
- `border-default`
- `border-strong`
- `text-primary`
- `text-secondary`
- `text-tertiary`
- `icon`
- `focus`
- semantic success/warning/danger/info

Dark mode should move closer to a neutral near-black canvas with smaller
lightness differences between tiled surfaces. Selection should be a controlled
surface step plus focus treatment, not a large opaque gray stripe. Saturated
color is reserved for state, focus, and primary action.

Light mode receives equivalent hierarchy; it is not produced by simply
inverting dark values. Add `system` as a theme option. Theme persistence moves
to the versioned preference envelope used by the rest of the shell, and the
pre-paint resolver supports migration from the old bare key without introducing
a launch flash.

### Typography

- Use the native/system sans stack initially; do not add a font dependency just
  to imitate Linear.
- Chrome metadata: 11 px / 14–16 px line height.
- Controls and dense rows: 12 px / 16–18 px.
- Default data/content UI: 13 px / 18–20 px.
- Pane/object headings: 14–16 px, medium.
- Focused document title: 22–24 px, medium or semibold.
- Avoid bold in chrome.
- Use tabular numerals for sizes, dates, counts, and progress.
- Use a tighter, explicit markdown prose scale instead of typography-plugin
  defaults.

### Spacing and dimensions

- 4 px base grid; common rhythm remains 8 px.
- Title/context header: 40 px.
- Sidebar default: about 220 px; resizable and collapsible.
- Inspector default: 320–360 px; resizable and contextual.
- Sidebar row: 28–30 px.
- Details row: 32–34 px default, 28–30 px compact.
- Icon button/input: 28 px default; 32 px only where touch target or content
  needs it.
- Icon: 14 px in rows, 16 px in controls.
- Reading measure: 680–760 px.

### Radius and elevation

- Tiled shell, content, tables, and panes: no outer radius and no shadow.
- Dense row highlight: 4 px radius where it does not break table alignment.
- Buttons/inputs: 5–6 px.
- Popovers/menus: 8–10 px with border and restrained layered shadow.
- Dialogs/Quick Preview: 10–12 px.
- Radius and shadow communicate elevation; they are not universal decoration.

### Motion

- Hover/color: 80–100 ms.
- Popover/tooltip: 100–120 ms.
- Inspector/sidebar disclosure: 140–160 ms.
- No general page transition.
- Respect `prefers-reduced-motion`.
- Never animate virtualized row position during ordinary filtering/sorting.

### Focus and accessibility

- Every interactive control has a visible `:focus-visible` state.
- Icon-only controls use real Radix tooltips containing label and shortcut.
- The directory tree uses the ARIA tree pattern. Details and gallery use an
  `aria-multiselectable` grid/listbox pattern selected before implementation;
  each surface has one keyboard focus owner.
- Filtering, deletion, and navigation define where focus moves when the focused
  item disappears.
- Body/control text meets WCAG AA 4.5:1; large text, icons, focus indicators,
  and meaningful non-text boundaries meet 3:1.
- Truncated names expose the full value through an accessible tooltip.
- Dialogs trap focus and restore it; popovers close on Escape; background
  surfaces become inert while a modal is open.
- At 200% zoom the shell enters its narrow behavior instead of clipping
  controls.

### Responsive shell thresholds

- **Wide (`≥1200px` CSS viewport):** approximately 220 px sidebar, primary
  surface at least 560 px, optional 320–360 px inspector.
- **Medium (`800–1199px`):** approximately 200 px sidebar; inspector opens as an
  overlay.
- **Narrow (`<800px`, including 640×480):** sidebar is collapsed/off-canvas,
  inspector and Quick Preview overlay the full primary surface, breadcrumbs
  truncate, and secondary header actions move into overflow.

At 640×480, traffic-light clearance, sidebar toggle, truncated context title,
and overflow action must fit without overlap.

---

## Target component architecture

### New shell feature

```
src/renderer/features/shell/
  components/
    AppShell.tsx
    WorkspaceSidebar.tsx
    WorkspaceHeader.tsx
    SidebarSection.tsx
    SidebarItem.tsx
    InspectorPane.tsx
  store/
    shellStore.ts
  hooks/
    useShellCommands.ts
```

`AppShell` owns native-title-bar geometry, global route controls, and the
inspector contract. React Router owns route history. Feature routes supply
header content and inspector content instead of building nested shells.

### Consolidated UI primitives

```
src/renderer/shared/ui/
  IconButton.tsx
  Tooltip.tsx
  Menu.tsx
  Popover.tsx
  Dialog.tsx
  SegmentedControl.tsx
  Switch.tsx
  Chip.tsx
  Kbd.tsx
  Badge.tsx
  EmptyState.tsx
  Skeleton.tsx
```

Existing primitives migrate rather than coexist indefinitely. Add Radix Dialog
and Popover packages if needed for correct focus semantics; do not add an
animation library.

### Reshaped disk explorer

```
src/renderer/features/disk-explorer/
  components/
    FilesRoute.tsx
    DirectoryHeader.tsx
    DirectoryView.tsx
    FileList.tsx
    FileGallery.tsx
    FileInspector.tsx
    FileWorkspace.tsx
    ViewOptionsPopover.tsx
    FilterPopover.tsx
    ActiveFilters.tsx
  store/
    diskStore.ts
    viewPreferencesStore.ts
    tabsStore.ts
  navigation/
    filesLocation.ts
    pathMutationCoordinator.ts
```

The exact file split should follow real component size, but these
responsibilities stay separate:

- directory navigation
- selection
- presentation configuration
- peek/inspector
- focused file workspace
- opened tabs

### Commands and shortcuts

Extend the command model with:

- section/category
- icon
- shortcut display
- keywords
- availability predicate
- scope

A central shortcut layer invokes commands and understands modal/input scope.
Raw global key listeners are removed as commands migrate. The same identifiers
continue to drive the native app menu.

Target shortcuts:

- `Cmd+K`: Command Menu
- `/`: reserved for real workspace search; do not bind it to a command-only
  surface
- `Cmd+F`: find/filter current view
- `F`: filter menu when list focus owns the keyboard
- `Shift+V`: display options
- `Cmd+B`: toggle workspace sidebar
- `Cmd+Alt+B`: toggle inspector
- Space: Quick Preview
- Return: rename selected filesystem item
- `Cmd+Down`: open selected item
- `Cmd+W`: close focused file tab, then focus surface, never the whole window

Accelerator ownership is singular:

- Electron's native menu owns app-global macOS accelerators such as `Cmd+,`,
  `Cmd+O`, Edit roles, and pane toggles, then dispatches the shared command ID
  to the renderer.
- The renderer shortcut manager does not bind a second listener for those
  accelerators.
- The renderer owns context-scoped, non-menu keys such as `F`, `Shift+V`,
  Return, Space, and `Cmd+Down`.
- Command availability changes are reported back to main when route/selection
  scope changes so a visible native item is disabled rather than firing a
  duplicate or impossible action.

Linear's shortcuts are inspiration, not a reason to break macOS/Finder
expectations.

---

## Migration decisions

1. **Keep React Router authoritative.** Shell state does not duplicate route
   history.
2. **Remove the centered Explorer/Files switch.** It advertises two competing
   products and consumes the most valuable title-bar position.
3. **Keep `/explorer` reachable as Notes during migration.** Do not spend this
   project restyling components scheduled for retirement, but do not hide
   create/edit, backlinks, or chat.
4. **Delay the default-route decision.** Preserve existing/last-used behavior
   through the shell and decide first-run default at Visual Review Gate 3 after
   checking the capability matrix.
5. **Move file tabs to the primary workspace.** Selection no longer opens a tab,
   and explicit opens create real tabs rather than preview tabs.
6. **Make the inspector contextual.** Do not reserve blank space before
   selection.
7. **Reuse the native-shell work.** Window bounds, no-flash theme, real traffic
   lights, app menu, preference envelope, and pane persistence are foundations,
   not work to redo.
8. **Resequence the context-menu plan.** Its FileWriter/IPC/native-menu design
   remains valid, but surface wiring must target the redesigned rows, tree, tabs,
   and inspector rather than today's components.
9. **Defer board and rich activity UI.** They ship only with real metadata and
   event models.

### Capability preservation

| Capability | Current owner | Redesign requirement |
|---|---|---|
| Create/edit/delete database-backed notes and folders | `/explorer` | Remains reachable as Notes throughout this plan |
| Related notes and Chat | `/explorer` right sidebar | Remains reachable; is not imitated with dead controls in `/files` |
| Browse allowed filesystem roots | `/files` | Moves into the shared shell and redesigned details/gallery surface |
| Rename, trash, move, reveal, external open | `/files` | Preserved and exposed through commands/native context menus |
| Markdown/media/PDF/text preview | `/files` inspector | Preserved in Peek and moved to the primary surface in Focus |
| Quick Preview | `/files` renderer overlay | Preserved, renamed honestly, and made compatible with arrow navigation |

No shell task may remove a capability from navigation before its replacement is
live.

---

## Non-goals

- Copying Linear's name, exact palette, assets, or project-management taxonomy.
- Adding fake collaboration, status, activity, or agent affordances.
- Rewriting main-process filesystem services during the visual foundation.
- Building a metadata-backed board before the metadata layer exists.
- A new animation framework.
- Screenshot/visual-regression tests.
- A second standalone polish pass over the retiring `/explorer`
  implementation. It still receives the shared outer shell.

---

## Success criteria

### Product

- Opal opens into one coherent workspace rather than a choice between two
  competing explorers.
- Browse, Peek, and Focus are visibly and behaviorally distinct.
- Selecting a file does not navigate, open a tab, or destroy the directory
  context.
- The right inspector is useful when visible and consumes no space when closed.
- Command Menu, in-view filtering, view configuration, and common file actions
  are discoverable by pointer and keyboard.
- Long-form markdown is comfortable to read and does not wrap in a narrow
  utility pane.

### Visual

- At rest, `/files` uses one context header, not three stacked control rows.
- No hard-coded Tailwind palette colors remain in the new shell, command menu,
  `/files`, dialogs, or settings.
- Flat data surfaces use borders and alignment; radius/shadow identify floating
  surfaces.
- Dark and light themes both have distinct canvas/sidebar/surface hierarchy.
- The UI remains coherent at 1440 × 900, 1024 × 700, and the application's
  minimum window size.

### Interaction

- Cached route/directory navigation marks from intent to painted surface at
  ≤50 ms median in the repeatable manual fixture.
- A received 5,000-entry listing reaches its first meaningful virtualized paint
  within the existing ≤150 ms budget.
- Pure filtering, view derivation, and flattened-tree derivation for 5,000
  entries each stay within one 16 ms frame.
- Selection reducer work stays below 4 ms and produces visible feedback by the
  next animation frame.
- Opening a previously loaded inspector produces usable content within 100 ms.
- Timing marks measure real renderer transitions; CI enforces deterministic
  pure work and does not use noisy wall-clock DOM assertions.
- Sidebar, content, and inspector restore without a first-paint layout flash.
- Every icon-only action has a tooltip and keyboard-accessible name.
- One command is not implemented three different ways for menu, shortcut, and
  button.
- Virtualized 5,000-entry folders remain responsive.

### Verification

- Behavior is covered by unit/component tests at the cheapest useful tier.
- The existing E2E budget is not spent on visual assertions.
- Manual review uses a repeatable sample workspace and the timestamped Linear
  reference states, not screenshot diffing.
