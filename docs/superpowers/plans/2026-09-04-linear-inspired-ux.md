# Linear-Inspired Opal UX Implementation Plan

> **For agentic workers:** Execute one task at a time, run the named checks, and
> commit at each task boundary. This is a vertical-slice redesign, not a
> one-shot CSS rewrite. Stop for the three visual review gates.

**Goal:** Give Opal the stable shell, density, contextual detail modes,
progressive disclosure, and keyboard fluency that make Linear feel materially
better, while preserving filesystem-native behavior and Opal's own product
model.

**Design:** `docs/superpowers/specs/2026-09-04-linear-inspired-ux-design.md`

**Reference recording:** `~/Desktop/linear.mov`. If unavailable, use the
timestamped audit in the design spec; the video is not a build dependency.

**Architecture:** Replace the fixed `Navbar` + nested permanent panes with a
single `AppShell`. Split directory navigation, selection, peek, focused content,
and tabs into explicit state. Rebuild `/files` as a route-supplied workspace
surface with contextual header and inspector. Consolidate shared controls under
a semantic token/primitives layer, then migrate commands, dialogs, menus, and
settings onto it.

**Tech stack:** Electron 31, React 18, React Router 6, Zustand 5,
react-resizable-panels 2, react-window 1, Tailwind 3, Radix primitives, KBar,
Lucide, Vitest/Testing Library, Playwright.

---

## The central constraint

This work must not become "make everything blacker and smaller."

The visual result depends on five behavioral changes landing together:

1. One stable application shell.
2. Selection separated from navigation and opening.
3. Contextual—not permanent—peek and inspector surfaces.
4. View controls hidden behind coherent Filter and Display surfaces.
5. One command path shared by buttons, shortcuts, palette, and native menu.

If a task changes visual styling without preserving those rules, it is outside
the design.

---

## Prior work to preserve

- Native traffic lights, no-flash launch, and window-state persistence.
- Versioned renderer preferences.
- Resizable/persisted pane primitives.
- Native app menu and shared command identifiers.
- Performance budgets.
- The existing disk reader/writer/watcher, root guard, file protocols,
  thumbnails, virtualization, selection tests, previews, the current
  app-rendered Quick Look, and tabs store.
- The native context-menu design and its pure-main-process architecture.

This plan **resequences** the context-menu implementation:

- Capability work in `FileWriter`, IPC, clipboard, and native menu construction
  remains valid.
- Renderer wiring waits until the new file rows, tree, inspector, and tab strip
  exist.
- `docs/superpowers/plans/2026-08-17-context-menus.md` is a source plan, not a
  second independent surface implementation.

---

## Global constraints

- Do not copy Linear's branding, exact assets, issue taxonomy, or collaboration
  concepts.
- Do not add dead sidebar destinations to make the navigation look populated.
- Do not build Board view before authored properties/sidecars exist.
- Do not polish the internals of `file-explorer-v2`; it is a temporary Legacy
  Notes implementation under the shared Notes destination.
- Do not hide or remove Notes creation/editing, related notes, or Chat before a
  replacement exists.
- Keep React Router authoritative for top-level navigation. Do not add a second
  shell-owned route stack.
- Do not label the Command Menu as workspace search; real search waits for the
  index/search slice.
- Do not replace native app/context menus with HTML imitations.
- Do not use native menus for rich Filter or Display controls; those are
  renderer popovers.
- Do not add a page-transition animation system or animation dependency.
- Do not add visual-regression or screenshot-diff tests.
- Do not spend the remaining E2E slot on layout or styling.
- Do not relax the existing performance budgets to land richer rows.
- Renderer code never imports `electron`, `fs`, or `path`.
- New IPC channels still require preload type exposure, a main handler, and IPC
  contract coverage in the same task.
- Persisted UI state is versioned, validated, and readable before first paint.
- New interactive elements receive stable `data-testid` values.
- CSS is verified manually; behavior and state are tested.
- Record the TypeScript-error baseline before implementation. Do not silently
  absorb new errors into the known legacy baseline.

### Capability preservation gate

Before each shell cutover, verify:

| Existing capability | Must remain reachable through |
|---|---|
| Database-backed note/folder create, edit, delete | Notes |
| Related notes and Chat | Notes |
| Allowed-root file browsing and gallery | Files |
| Rename, trash, move, reveal, external open | Files commands/context menus |
| Markdown, text, image, PDF, audio, video preview | Peek, Focus, or Quick Preview |

---

## Target file structure

The exact split may adjust to keep files small, but responsibilities should end
up here:

```
src/renderer/
  features/
    shell/
      components/
        AppShell.tsx
        Titlebar.tsx
        WorkspaceSidebar.tsx
        WorkspaceHeader.tsx
        SidebarSection.tsx
        SidebarItem.tsx
        InspectorPane.tsx
      context/
        ShellContext.tsx
      hooks/
        useShellCommands.ts
      store/
        shellStore.ts
      index.ts

    disk-explorer/
      components/
        FilesRoute.tsx
        DirectoryHeader.tsx
        DirectoryView.tsx
        FileList.tsx
        FileGallery.tsx
        FileInspector.tsx
        FileWorkspace.tsx
        FilterPopover.tsx
        ViewOptionsPopover.tsx
        ActiveFilters.tsx
        OpenFilesBar.tsx
      hooks/
        useFilesCommands.ts
        useFilesKeyboardScope.ts
      store/
        diskStore.ts
        viewPreferencesStore.ts
        tabsStore.ts
      navigation/
        filesLocation.ts
        pathMutationCoordinator.ts

  shared/
    ui/
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
      index.ts
```

Do not create one file per trivial wrapper mechanically. Merge components that
remain tiny and split any file approaching 500 lines.

---

## Phase 0 — Evidence and foundations

### Task 0: Record the implementation baseline

**Files**

- Create: `docs/superpowers/plans/baseline-linear-inspired-ux.txt`

**Steps**

- [x] Record current branch and commit.
- [x] Fetch `origin` and record ahead/behind state without merging unrelated
      work.
- [x] Run `npx tsc --noEmit`, count errors, and record the known legacy files.
- [x] Run `npm test` and record files/tests/time.
- [x] Run `npm run test:e2e` and record tests/time.
- [x] Confirm the E2E suite still contains no more than ten tests.
- [x] Launch real Electron and inspect:
  - `/files`, no selection
  - `/files`, markdown selected
  - `/files`, image gallery
  - `/explorer`, empty
  - Settings
- [x] Record manual screenshots locally for before/after review. Do not turn
      them into automated assertions or commit user data.
- [x] Commit: `docs: record linear-inspired UX baseline`

**Acceptance**

- The baseline makes pre-existing failures explicit.
- No production code changes.

---

### Task 1: Expand semantic tokens and theme resolution

**Files**

- Modify: `src/renderer/styles/index.css`
- Modify: `tailwind.config.js`
- Modify: `docs/design-tokens.md`
- Modify: `src/renderer/features/theme/config/themeConfig.ts`
- Modify: `src/renderer/features/theme/utils/themeUtils.ts`
- Modify: `src/renderer/features/theme/context/ThemeContext.tsx`
- Modify: `src/renderer/shared/prefs/prefs.ts`
- Create: `src/common/theme.ts`
- Modify: `src/renderer/shared/types/index.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/services/system/SystemHandlers.ts`
- Modify: `index.html`
- Modify as needed: `src/main/window/WindowStateStore.ts`
- Modify as needed: `src/main.ts`
- Test: `src/tests/unit/theme.test.tsx`
- Test: `src/tests/unit/prefs.test.ts`
- Test: `src/tests/unit/systemHandlers.test.ts`
- Test: `src/tests/unit/window/windowStateStore.test.ts`

**Steps**

- [x] Add semantic CSS variables for canvas, sidebar, surfaces, three border
      strengths, three text strengths, icon, hover, active, selected, and focus.
- [x] Keep compatibility aliases for existing shadcn-style token names during
      migration.
- [x] Define dark and light palettes independently.
- [x] Add `system` to the user's theme preference while reporting the resolved
      light/dark theme hint to main for no-flash launch.
- [x] Move the bare `theme` localStorage value into the versioned `opal.theme`
      preference envelope. Keep the pre-paint script backward-compatible for
      one migration cycle and teach it to resolve the envelope before React
      starts.
- [x] Add typography, control-height, row-height, sidebar-width,
      inspector-width, elevation, and motion variables.
- [x] Add reduced-motion behavior.
- [x] Update `docs/design-tokens.md` with the flat-surface/elevated-overlay rule.
- [x] Test preference resolution and corrupt/unknown values.
- [x] Launch Electron and verify the pre-paint background still matches the
      resolved theme.
- [x] Commit: `feat(ui): establish semantic shell tokens`

**Acceptance**

- Tokens can describe sidebar, canvas, panel, selected row, and popover without
  raw palette classes.
- Existing screens remain usable during compatibility migration.
- No theme flash is introduced.

---

### Task 2: Build the compact shared UI primitives

**Dependencies**

- Add only if required for correct semantics:
  - `@radix-ui/react-dialog`
  - `@radix-ui/react-popover`
  - `@radix-ui/react-switch`

**Files**

- Create/migrate under: `src/renderer/shared/ui/`
- Modify transitional exports under: `src/renderer/shared/components/`
- Modify: `src/renderer/shared/utils/cn.ts`
- Modify: `components.json`
- Test: `src/tests/unit/uiPrimitives.test.tsx`

**Steps**

- [x] Implement `IconButton` at compact and default sizes with
      `focus-visible`, disabled, active, and destructive states.
- [x] Make `cn` merge-aware with the installed `clsx`/`tailwind-merge` stack so
      primitive variants and caller overrides resolve deterministically.
- [x] Correct the shadcn metadata to point at the real renderer stylesheet,
      component directory, and utility alias before using it to add primitives.
- [x] Make every icon-only use require an accessible label; compose a Radix
      tooltip with optional shortcut display.
- [x] Migrate the existing dropdown implementation into tokenized `Menu`
      primitives.
- [x] Add a real `Popover` for rich controls and a focus-managed `Dialog`.
- [x] Add `SegmentedControl`, `Switch`, `Chip`, `Kbd`, and `Badge`.
- [x] Move `EmptyState` and skeleton patterns into shared primitives without
      making copy generic or verbose.
- [x] Reserve radius/shadow for menus, popovers, dialogs, and Quick Preview.
- [x] Test keyboard activation, Escape dismissal, focus restore, disabled
      behavior, radio/selection semantics, and accessible names.
- [x] Do not assert Tailwind class strings.
- [x] Commit: `feat(ui): add compact accessible primitives`

**Acceptance**

- New shell/files components need no one-off button, tooltip, popover, or modal
  implementation.
- Existing components can migrate incrementally through compatibility exports.

---

## Phase 1 — Interaction state and one stable application shell

### Task 3: Separate directory, selection, preview, and open state

**Files**

- Modify: `src/renderer/features/disk-explorer/store/diskStore.ts`
- Create: `src/renderer/features/disk-explorer/store/diskPathState.ts`
- Modify: `src/renderer/features/disk-explorer/store/tabsStore.ts`
- Modify: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Create: `src/common/fsPaths.ts`
- Create: `src/renderer/features/disk-explorer/navigation/filesLocation.ts`
- Create: `src/renderer/features/disk-explorer/navigation/filesLocationSnapshots.ts`
- Create: `src/renderer/features/disk-explorer/navigation/pathMutationCoordinator.ts`
- Test: `src/tests/unit/diskStore.test.ts`
- Test: `src/tests/unit/filesLocation.test.ts`
- Test: `src/tests/unit/fsPaths.test.ts`
- Test: `src/tests/unit/pathMutationCoordinator.test.ts`
- Modify: `src/tests/unit/tabsStore.test.ts`
- Modify compatibility coverage: `src/tests/unit/multiSelect.test.tsx`,
  `src/tests/unit/quickLook.test.tsx`, `src/tests/unit/tabStrip.test.tsx`

**State migration**

- Add `currentDirectory`.
- Keep `selectedPaths`.
- Replace overloaded `selectedPath` with an explicit primary/focused selection.
- Add explicit `openedPath` or derive it only from active open tabs.
- Keep Quick Preview independent.

**Steps**

- [x] Define the pointer/keyboard interaction matrix from the design spec as
      pure store transitions before changing the shell.
- [x] Add explicit open-tab actions and a migration adapter for the current
      `previewPath`/`openPreview` callers. Do not remove those callers until
      Task 7 updates the components in the same green commit.
- [x] Define normalized browse/focus router locations carrying only
      route-affecting directory/open-file state.
- [x] Define a non-routing snapshot keyed by router location for selection and
      scroll restoration.
- [x] Fix mutation semantics: directory navigation and Focus open push;
      invalid-route fallback and app-initiated current-path remap replace;
      selection/filter/sort/resize/scroll never mutate history.
- [x] Define one old→new subtree remap operation for app-initiated rename/move
      and one conservative stale-state cleanup for ambiguous external events.
- [x] Choose and document ARIA patterns: directory sidebar as tree;
      multi-select details/gallery as one-focus-owner grid/listbox with
      `aria-multiselectable`.
- [x] Define focus fallback after filtering, deletion, navigation, and stale
      watcher updates.
- [x] Keep compatibility selectors/actions only where required to let current
      components compile until Task 7; mark each for removal there.
- [x] Test all state transitions, subtree remapping, router-location
      normalization, and corrupt/stale input.
- [x] Commit: `refactor(files): define navigation selection and opening state`

**Acceptance**

- The new shell can consume explicit directory/focus state rather than today's
  overloaded `selectedPath`.
- React Router has a normalized files location contract before Back/Forward is
  exposed in the shell.
- The target contract says tabs contain opened files only; the temporary
  preview adapter is isolated and removed in Task 7.

---

### Task 4: Add shell state and route contracts

**Files**

- Create: `src/renderer/features/shell/store/shellStore.ts`
- Create: `src/renderer/features/shell/context/ShellContext.tsx`
- Create: `src/renderer/features/shell/index.ts`
- Test: `src/tests/unit/shellStore.test.tsx`

**State**

- Sidebar open/closed and width.
- Inspector open/closed, width, and active tab.
- Route-supplied header and inspector descriptors.
- React Router location is read, never duplicated.

**Steps**

- [x] Persist only cosmetic shell preferences; validate every restored shape.
- [x] Provide a route API for header title/breadcrumb/actions and inspector
      content.
- [x] Define the contract that top-level Back/Forward uses React Router and that
      `/files` browse/focus transitions use the location model from Task 3.
- [x] Test route descriptor lifecycle, restored preferences, and corrupt
      fallback.
- [x] Commit: `feat(shell): add unified shell state`

**Acceptance**

- `/files`, Settings, and Notes can share route context and pane controls.
- State is independent of component-local mount timing.
- No second route/history authority exists.

---

### Task 5: Build `AppShell`, title bar, and workspace sidebar

**Files**

- Create: `src/renderer/features/shell/components/AppShell.tsx`
- Create: `src/renderer/features/shell/components/Titlebar.tsx`
- Create: `src/renderer/features/shell/components/WorkspaceSidebar.tsx`
- Create: `src/renderer/features/shell/components/WorkspaceHeader.tsx`
- Create: `src/renderer/features/shell/components/SidebarSection.tsx`
- Create: `src/renderer/features/shell/components/SidebarItem.tsx`
- Create: `src/renderer/features/shell/components/DirectoryTree.tsx`
- Create: `src/renderer/features/shell/utils/flattenDirectoryTree.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskTree.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskTreeItem.tsx`
- Test: `src/tests/unit/appShell.test.tsx`
- Test: `src/tests/unit/workspaceSidebar.test.tsx`
- Test: `src/tests/unit/flattenDirectoryTree.test.ts`

**Steps**

- [ ] Replace fixed `Navbar` + `mt-10` with real full-height shell layout.
- [ ] Preserve the native drag region and a no-drag region for every control.
- [ ] Align workspace sidebar header and route context header on one 40 px row.
- [ ] Add universal back/forward, sidebar toggle, context title/breadcrumb slot,
      and trailing action slot.
- [ ] Use React Router for route activation and Back/Forward.
- [ ] Render real destinations only: Notes, Files, open roots/tree, and
      Settings.
- [ ] If Recent/Favorites stores are not implemented yet, omit those rows until
      Task 13 rather than shipping inert placeholders.
- [ ] Keep workspace Search absent until a real index/search feature exists.
- [ ] Reuse lazy tree loading and root security behavior, but show directories
      only in sidebar navigation.
- [ ] Flatten and virtualize large visible directory trees; preserve tree ARIA
      levels and expansion state.
- [ ] Keep flattening 5,000 visible directories within one 16 ms frame and
      render only the viewport.
- [ ] Implement shell thresholds now: wide ≥1200 px, medium 800–1199 px, narrow
      <800 px. At narrow width the sidebar is off-canvas/collapsed and header
      actions overflow without colliding with traffic lights.
- [ ] Preserve current/last-used route behavior; do not switch the first-run
      default yet.
- [ ] Remove the centered Explorer/Files route switch.
- [ ] Keep `/explorer` reachable as `Notes`.
- [ ] Ensure sidebar collapse is controlled by the same command/preference that
      the native View menu uses.
- [ ] Test route activation, tree expansion, collapse behavior, and accessible
      names.
- [ ] Commit: `feat(shell): replace navbar with workspace shell`

**Acceptance**

- The application has one visual frame.
- Route changes replace only the workspace surface.
- Native traffic lights remain correctly aligned in windowed/full-screen modes.

---

### Task 6: Upgrade the command and shortcut layer

**Files**

- Modify: `src/renderer/features/commands/services/commandRegistry.ts`
- Modify: `src/common/commandIds.ts`
- Create: `src/renderer/features/shell/hooks/useShellCommands.ts`
- Create: `src/renderer/features/commands/components/ShortcutManager.tsx`
- Rewrite: `src/renderer/features/kbar/components/KBar.tsx`
- Modify: `src/renderer/features/kbar/context/KBarActionsProvider.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/shared/types/index.ts`
- Modify: `src/main/menu/menuTemplate.ts`
- Modify: `src/main/menu/AppMenu.ts`
- Modify: `src/main/services/system/SystemHandlers.ts`
- Modify: `src/preload.ts` only if the existing report payload must change
- Test: `src/tests/unit/commandRegistry.test.ts`
- Test: `src/tests/unit/commandMenu.test.tsx`
- Modify: `src/tests/unit/menuTemplate.test.ts`

**Steps**

- [ ] Extend command metadata with section, keywords, shortcut display, scope,
      optional icon key, and availability predicate.
- [ ] Keep command identifiers serializable and shared with main.
- [ ] Add one shortcut manager that respects editor/input/modal scope.
- [ ] Register shell commands for sidebar, inspector, Command Menu, Files,
      Notes, Settings, back, and forward.
- [ ] Rebuild KBar visually as the Opal Command Menu using semantic tokens.
- [ ] Group results and render shortcut hints.
- [ ] Remove hard-coded white/gray/blue KBar colors.
- [ ] Keep app-menu reporting generated from the same registry.
- [ ] Make Electron's native menu the sole owner of app-global macOS
      accelerators; its click dispatches a command ID to the renderer.
- [ ] Do not bind those same accelerators in `ShortcutManager`.
- [ ] Keep context-scoped keys (`F`, `Shift+V`, Return, Space, `Cmd+Down`) in the
      renderer only.
- [ ] Re-report enabled/disabled command state when route or selection scope
      changes so the native menu does not invoke impossible actions.
- [ ] Migrate global shell listeners first; feature-level filesystem shortcuts
      move in Task 7/9.
- [ ] Test duplicate IDs, unavailable commands, scope, keyboard invocation, and
      menu reporting.
- [ ] Commit: `feat(commands): unify command menu and shortcuts`

**Acceptance**

- Sidebar buttons, shortcuts, Command Menu, and native menu execute the same
  command objects.
- Command Menu feels like a primary product surface, not a themed text input.

---

### Visual review gate 1: Shell

- [ ] Run Electron at 1440 × 900, 1024 × 700, and minimum size.
- [ ] Compare against the recording at 00:04, 00:12, and 00:36.
- [ ] Review sidebar density, active/hover hierarchy, title-bar geometry,
      content space, and route continuity.
- [ ] Tune tokens and dimensions before proceeding.
- [ ] Do not continue if the result is only "current Opal with a Linear-colored
      sidebar."

---

## Phase 2 — Rebuild `/files` on the explicit interaction state

### Task 7: Migrate file components to explicit interaction state

**Files**

- Modify: `src/renderer/features/disk-explorer/store/diskStore.ts`
- Modify: `src/renderer/features/disk-explorer/store/tabsStore.ts`
- Create: `src/renderer/features/disk-explorer/components/FilesRoute.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskTreeItem.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DiskFolderView.tsx`
- Test: `src/tests/unit/diskStore.test.ts`
- Test: `src/tests/unit/filesNavigation.test.tsx`
- Modify: `src/tests/unit/multiSelect.test.tsx`
- Modify: `src/tests/unit/tabsStore.test.ts`

**Integration contract**

- Consume the explicit state and router-location model from Task 3.
- Remove every temporary compatibility selector/action introduced by Task 3.

**Steps**

- [ ] Make tree activation navigate to a directory.
- [ ] Make a list/gallery single click select without navigating or opening a
      tab.
- [ ] Make double click navigate into a folder or focus/open a file.
- [ ] Keep Return=rename, `Cmd+Down`=open, Space=Quick Preview.
- [ ] Add buffered typeahead for the focused sidebar tree and directory
      collection over their visible items. Never intercept printable keys from
      inputs, menus, dialogs, editors, or other text-entry surfaces.
- [ ] Remove the effect that opens a preview tab whenever selection changes.
- [ ] Retire `previewPath`; explicit file opens create real tabs.
- [ ] Preserve multi-selection when selecting folders.
- [ ] Define behavior when watcher events remove current, selected, peeked, or
      opened paths.
- [ ] Encode normalized browse/focus locations through React Router
      state/search params; top-level and files navigation use one history.
- [ ] Restore directory from the route and selection/scroll from the
      non-routing location snapshot on Back; selection and scrolling must not
      create or replace route entries.
- [ ] Wire the Task 3 subtree-remap coordinator into current directory,
      listings, selection, tabs, router location, and inspector; later stores
      implement the same contract.
- [ ] On external removal, clear stale state rather than guessing rename
      identity from watcher directory notifications.
- [ ] Preserve the Task 3 ARIA/focus contract in component event handlers so
      Task 10 can change presentation without changing semantics.
- [ ] Test pointer, keyboard, and typeahead semantics exhaustively before
      styling rows.
- [ ] Commit: `refactor(files): migrate components to explicit interaction state`

**Acceptance**

- Selection is cheap and reversible.
- A user can select several folders without the first click navigating away.
- Tabs contain opened files only.
- Rename/move/root removal cannot leave a live tab or location pointing at an
  unrelated stale path.

---

### Task 8: Add validated per-directory view configuration

**Files**

- Create: `src/renderer/features/disk-explorer/store/viewPreferencesStore.ts`
- Create: `src/common/directoryView.ts`
- Modify: `src/common/filterEntries.ts`
- Modify: `src/common/sortEntries.ts`
- Test: `src/tests/unit/viewPreferencesStore.test.ts`
- Test: `src/tests/unit/fs/filterEntries.test.ts`
- Test: `src/tests/unit/fs/sortEntries.test.ts`

**Shape**

- Layout: details, gallery.
- Density: default, compact.
- Sort field/direction.
- Folders-first behavior.
- Visible columns.
- Active filters over name, kind, file/directory, modified range, and size.

**Steps**

- [ ] Define a versioned schema and defaults.
- [ ] Validate restored values and changed column sets.
- [ ] Store one capped map keyed by root + relative directory path, not one
      localStorage key per absolute directory.
- [ ] Cap it at 250 directory records with LRU eviction; define quota-failure
      fallback, subtree remap, and cleanup when a root is removed.
- [ ] Keep temporary text search separate from durable display preferences.
- [ ] Preserve today's image-heavy gallery suggestion only for directories with
      no explicit preference.
- [ ] Keep this state app-local for now; document migration to authored
      per-folder metadata when that layer ships.
- [ ] Test unknown versions, corrupt data, directory independence, and pure
      filtering/sorting, eviction, remap, root cleanup, and quota failure.
- [ ] Commit: `feat(files): persist contextual directory views`

**Acceptance**

- Navigating away and back restores how that directory was viewed.
- One directory's gallery choice does not turn every folder into a gallery.

---

### Task 9: Replace toolbar rows with a contextual directory header

**Files**

- Create: `src/renderer/features/disk-explorer/components/DirectoryHeader.tsx`
- Create: `src/renderer/features/disk-explorer/components/FilterPopover.tsx`
- Create: `src/renderer/features/disk-explorer/components/ViewOptionsPopover.tsx`
- Create: `src/renderer/features/disk-explorer/components/ActiveFilters.tsx`
- Modify/retire: `src/renderer/features/disk-explorer/components/Toolbar.tsx`
- Modify: `src/renderer/features/disk-explorer/components/Breadcrumb.tsx`
- Create: `src/renderer/features/disk-explorer/hooks/useFilesCommands.ts`
- Create: `src/renderer/features/disk-explorer/hooks/useFilesKeyboardScope.ts`
- Test: `src/tests/unit/directoryHeader.test.tsx`
- Test: `src/tests/unit/filterPopover.test.tsx`
- Test: `src/tests/unit/viewOptionsPopover.test.tsx`
- Modify: `src/tests/unit/toolbar.test.tsx`

**Steps**

- [ ] Supply the route header through `ShellContext`.
- [ ] Left side: breadcrumb/current directory and overflow. Task 13 adds
      favorite only when its store exists.
- [ ] Right side: new item, in-view search, filter, display options, inspector.
- [ ] Collapse in-view search until invoked by button or `Cmd+F`.
- [ ] Implement `F` for filters and `Shift+V` for Display options in files scope.
- [ ] Put layout, density, sort, direction, folders-first, and visible columns
      into one Display popover.
- [ ] Render active filters as removable chips on a second row only when active.
- [ ] Avoid duplicate item-count rows; place count in header metadata or footer
      where it remains useful.
- [ ] Test Escape, focus return, keyboard shortcuts, applied-filter visibility,
      and persistence.
- [ ] Commit: `feat(files): add contextual filter and display controls`

**Acceptance**

- At rest, a directory has one row of chrome.
- Advanced controls remain one action/shortcut away.

---

### Task 10: Build dense virtualized details and gallery surfaces

**Files**

- Create: `src/renderer/features/disk-explorer/components/DirectoryView.tsx`
- Create: `src/renderer/features/disk-explorer/components/FileList.tsx`
- Create: `src/renderer/features/disk-explorer/components/FileGallery.tsx`
- Refactor: `src/renderer/features/disk-explorer/components/DiskFolderView.tsx`
- Modify: `src/renderer/features/disk-explorer/hooks/useGridNavigation.ts`
- Modify: `src/renderer/features/disk-explorer/hooks/useElementSize.ts`
- Modify: `src/renderer/features/disk-explorer/components/Skeleton.tsx`
- Modify: `src/renderer/shared/perf/marks.ts`
- Test: `src/tests/unit/directoryView.test.tsx`
- Test: `src/tests/unit/fileList.test.tsx`
- Modify: `src/tests/unit/diskFolderView.test.tsx`
- Modify: `src/tests/unit/gridNavigation.test.tsx`
- Modify: `src/tests/unit/dragAndDrop.test.tsx`
- Modify: `src/tests/perf/budgets.test.ts`

**Steps**

- [ ] Keep react-window virtualization.
- [ ] Create one shared row/tile selection contract across layouts.
- [ ] Use compact aligned metadata and tabular numbers.
- [ ] Details headers sort and reflect direction; visible columns come from view
      config.
- [ ] Keep the details column header sticky outside the virtualized item body.
- [ ] Reveal selection checkbox/secondary actions on hover and keyboard focus
      without changing row geometry.
- [ ] Reduce row height while preserving an obvious focus/selection state.
- [ ] Tune gallery thumbnail ratio, filename baseline, and compact/default
      density.
- [ ] Preserve lazy thumbnails and thumbnail-error fallback.
- [ ] Preserve drag/drop target semantics without using a large saturated ring.
- [ ] Implement the ARIA pattern chosen in Task 3, including
      `aria-multiselectable`, one focus owner, row/tile position labels, and
      deterministic focus fallback.
- [ ] Test layout switching, selection, range selection, type-ahead, keyboard
      movement, drag/drop, and empty/loading states.
- [ ] Add deterministic budgets for 5,000-entry view derivation and flattened
      directory-tree derivation (≤16 ms each), while keeping received-listing
      to virtualized paint instrumentation at ≤150 ms.
- [ ] Commit: `feat(files): add dense contextual file views`

**Acceptance**

- Rows scan like structured data rather than a stack of buttons.
- Switching layout does not lose selection, scroll context, or view settings.

---

### Visual review gate 2: Browse

- [ ] Review no-selection, single-selection, multi-selection, empty folder,
      filtered-empty, 5,000-item, details, and gallery states.
- [ ] Compare against recording timestamps 00:20, 00:25, 00:27, and 00:36.
- [ ] Verify information density, header restraint, hover disclosure, and
      readable selection.
- [ ] Verify tree/list/inspector resizing does not cause virtualized overlap.

---

## Phase 3 — Peek, focus, and workspace continuity

### Task 11: Add the contextual file inspector

**Files**

- Create: `src/renderer/features/shell/components/InspectorPane.tsx`
- Create: `src/renderer/features/disk-explorer/components/FileInspector.tsx`
- Modify: `src/renderer/features/disk-explorer/components/detail/DetailPane.tsx`
- Modify preview components under:
  `src/renderer/features/disk-explorer/components/detail/`
- Modify: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Test: `src/tests/unit/inspectorPane.test.tsx`
- Test: `src/tests/unit/fileInspector.test.tsx`
- Modify: `src/tests/unit/detailPane.test.tsx`
- Modify: `src/tests/unit/diskExplorerPanes.test.tsx`

**Steps**

- [ ] Connect title-bar, native menu, shortcut, and pane visibility to one
      `shellStore` inspector state.
- [ ] Default the inspector closed for a new wide-layout user.
- [ ] Never auto-open it on selection; when the user opens it, it follows
      selection and closing it remains respected.
- [ ] Hide the inspector when it has no content unless the user explicitly
      pins it open.
- [ ] Single selection: preview plus real file metadata/actions.
- [ ] Multi-selection: count, aggregate size where known, and valid bulk
      actions; no arbitrary "last selected file" preview.
- [ ] Directory selection: folder facts/actions, not a fake document preview.
- [ ] Give preview and metadata tabs only if both contain meaningful content.
- [ ] Persist width/open state synchronously.
- [ ] Use contained skeleton/error states.
- [ ] At narrower widths, render as a dismissible overlay rather than shrinking
      content below its minimum, using the thresholds established in Task 5.
- [ ] Test empty, file, folder, multi-selection, toggle, and stale-path states.
- [ ] Commit: `feat(files): add contextual file inspector`

**Acceptance**

- Browse uses the full work surface until context is requested.
- Inspector content always explains why the panel is open.

---

### Task 12: Move opened files and tabs into the main focus surface

**Files**

- Create: `src/renderer/features/disk-explorer/components/FileWorkspace.tsx`
- Create/rename: `src/renderer/features/disk-explorer/components/OpenFilesBar.tsx`
- Refactor: `src/renderer/features/disk-explorer/components/TabStrip.tsx`
- Modify: `src/renderer/features/disk-explorer/store/tabsStore.ts`
- Modify: `src/renderer/features/disk-explorer/components/DiskExplorer.tsx`
- Modify: `src/renderer/features/disk-explorer/components/detail/MarkdownPreview.tsx`
- Modify: other detail renderers as needed
- Modify: `src/renderer/styles/index.css`
- Test: `src/tests/unit/fileWorkspace.test.tsx`
- Modify: `src/tests/unit/tabStrip.test.tsx`
- Modify: `src/tests/unit/tabsStore.test.ts`
- Modify: `src/tests/unit/quickLook.test.tsx`

**Steps**

- [ ] Enter Focus through double click, `Cmd+Down`, Open, or tab activation.
- [ ] Render focused content in the primary workspace, not the inspector.
- [ ] Move tabs above the focused primary surface.
- [ ] Remove preview-tab semantics; each explicit file open creates or activates
      a real tab.
- [ ] Add focused header/breadcrumb and return-to-directory behavior.
- [ ] Restore the prior directory selection and scroll position on Back.
- [ ] Apply the dedicated reading measure/type scale to markdown.
- [ ] Keep image, PDF, text, audio, and video surfaces modality-appropriate
      rather than forcing a prose max-width.
- [ ] Keep Quick Preview a separate app-rendered temporary overlay.
- [ ] Test opening, closing, cycling, Back restoration, stale files, and
      Quick-Preview/Focus independence.
- [ ] Remove class-name assertions from tab tests; assert semantic state.
- [ ] Commit: `feat(files): add focused file workspace`

**Acceptance**

- Long markdown reads like a primary document.
- Tabs describe real open work.
- Browse context is recoverable in one Back action.

---

### Task 13: Add real Recent and Favorites navigation

**Files**

- Create: `src/renderer/features/shell/store/recentItemsStore.ts`
- Create: `src/renderer/features/shell/store/favoritesStore.ts`
- Modify: `src/renderer/features/shell/components/WorkspaceSidebar.tsx`
- Modify: `src/renderer/features/disk-explorer/components/DirectoryHeader.tsx`
- Modify: `src/renderer/features/disk-explorer/components/FileWorkspace.tsx`
- Modify: `src/renderer/features/commands/` as needed
- Test: `src/tests/unit/recentItemsStore.test.ts`
- Test: `src/tests/unit/favoritesStore.test.ts`
- Modify: `src/tests/unit/workspaceSidebar.test.tsx`

**Steps**

- [ ] Track a capped, deduplicated recent list on explicit open/navigation.
- [ ] Persist favorites with versioned preferences.
- [ ] Gracefully remove or mark paths that no longer exist under allowed roots.
- [ ] Implement the shared subtree-remap/root-cleanup contract so rename, move,
      and root removal update both stores atomically with the files state.
- [ ] Add favorite toggles to directory/file headers and relevant menus.
- [ ] Add Recent and Favorites sections to the sidebar only now that they work.
- [ ] Add Command Menu result groups for open files, recent items, favorites,
      navigation, and commands.
- [ ] Test ordering, deduplication, limits, stale values, root removal, and
      command activation.
- [ ] Commit: `feat(shell): add recent and favorite items`

**Acceptance**

- Sidebar hierarchy reflects real user context, not decorative sample content.

---

### Visual review gate 3: Peek and Focus

- [ ] Compare Peek against recording 00:04–00:08.
- [ ] Compare Focus + metadata against 00:08–00:11 and 00:38–00:42.
- [ ] Verify the same selected file can be inspected, Quick Previewed, and opened
      without ambiguous state.
- [ ] Verify markdown measure, sticky context, inspector width, tab placement,
      and Back restoration.
- [ ] Recheck the capability-preservation matrix and decide first-run/default
      route only now. Existing users should return to their last-used surface.

---

## Phase 4 — Native actions and coherent feedback

### Task 14: Implement native context menus against redesigned surfaces

**Source plan**

- `docs/superpowers/plans/2026-08-17-context-menus.md`
- `docs/superpowers/specs/2026-08-17-context-menus-design.md`

**Capability files**

- Create: `src/common/contextActionIds.ts`
- Create: `src/common/batch.ts`
- Create: `src/main/fs/copyNames.ts`
- Modify: `src/main/fs/FileWriter.ts`
- Modify: `src/main/fs/DiskHandlers.ts`
- Create: `src/main/menu/contextMenuTemplate.ts`
- Create: `src/main/menu/ContextMenu.ts`
- Modify: `src/main.ts`
- Modify: `src/preload.ts`
- Modify: `src/renderer/shared/types/index.ts`

**Renderer files**

- Create: `src/renderer/features/disk-explorer/contextActions.ts`
- Create: `src/renderer/features/disk-explorer/hooks/useContextMenu.ts`
- Modify the new tree, row/tile, inspector, background, and tab components.

**Steps**

- [ ] Execute duplicate-name, copy/duplicate, batch result, IPC, clipboard,
      native template, popup, action dispatch, and tab-close tasks from the
      source plan.
- [ ] Bind entry menus to current multi-selection using Finder semantics.
- [ ] Bind background Sort/View actions to `viewPreferencesStore`.
- [ ] Bind inspector actions to its represented target, not an implicit global.
- [ ] Keep targets in both directions across IPC.
- [ ] On successful rename/move, invoke the path-mutation coordinator with the
      exact old→new path before watcher refresh; verify every registered store
      remaps the same subtree.
- [ ] Preserve the empty-menu guard; Electron must never receive an empty
      template.
- [ ] Test every action ID has a renderer handler.
- [ ] Do not add E2E coverage for an OS-drawn popup.
- [ ] Commit in the discrete capability/menu/wiring boundaries from the source
      plan.

**Acceptance**

- Every visible filesystem target has a native, keyboard-navigable action menu.
- Multi-target operations report partial outcomes truthfully.

---

### Task 15: Unify dialogs, Quick Preview, drag/drop, errors, and bulk feedback

**Files**

- Modify: `src/renderer/features/disk-explorer/components/dialogs/NameDialog.tsx`
- Modify: `src/renderer/features/disk-explorer/components/dialogs/ConfirmDeleteDialog.tsx`
- Rename/modify: `src/renderer/features/disk-explorer/components/QuickLook.tsx`
  to `QuickPreview.tsx`
- Modify new row/tile/tree components
- Create: `src/renderer/features/disk-explorer/components/BulkActionBar.tsx`
  only if multi-selection needs persistent actions
- Modify: `src/renderer/shared/components/Toast.tsx`
- Test: existing dialog, Quick Preview, drag/drop, and multi-select tests
- Add: `src/tests/unit/bulkActionBar.test.tsx` if created

**Steps**

- [ ] Move dialogs to the shared focus-managed primitive.
- [ ] Replace browser confirmations.
- [ ] Keep Finder basename-without-extension selection behavior.
- [ ] Give batch operations one progress/result surface, not one toast per file.
- [ ] Define error policy: field/operation errors inline; completed background
      failures in toast; never both for the same event.
- [ ] Restyle Quick Preview as a true elevated surface while reusing preview
      renderers.
- [ ] Keep Quick Preview app-rendered and modeless for list navigation: Escape
      closes it, while arrow keys can advance the selected preview target.
- [ ] Make drag source, valid target, invalid target, and drop completion clear
      without saturated full-surface decoration.
- [ ] Show a compact bulk action bar only when it adds actions not already
      discoverable via context menu/commands.
- [ ] Test focus trap/restore, Escape, submitting state, partial failure,
      selection snapshot, and drag cancellation.
- [ ] Commit: `feat(files): unify overlays and action feedback`

**Acceptance**

- Overlays share one elevation and keyboard grammar.
- Errors are specific, singular, and recoverable.

---

### Task 16: Bring Settings into the shell and primitive system

**Files**

- Refactor: `src/renderer/features/settings/components/Settings.tsx`
- Add settings subcomponents only where sections justify them
- Modify: `src/renderer/store/settingsStore.ts`
- Test: `src/tests/unit/settings.test.tsx`

**Steps**

- [ ] Render Settings under the shared shell with a contextual header.
- [ ] Replace hard-coded green/indigo/red/gray classes with semantic primitives.
- [ ] Replace `window.confirm` with shared Dialog confirmation.
- [ ] Group General, Appearance, AI, Data, and Danger Zone only around settings
      that really exist.
- [ ] Add system/light/dark selection.
- [ ] Use concise inline operation status.
- [ ] Hide unsupported embedding actions when the capability does not exist
      rather than explaining a restart workaround in the UI.
- [ ] Test form updates, confirmation, async status, failure, and focus return.
- [ ] Commit: `refactor(settings): adopt the workspace design system`

**Acceptance**

- Settings no longer looks like a separate web page.
- Dangerous and unavailable actions are represented honestly.

---

## Phase 5 — Adaptation, cleanup, and quality gates

### Task 17: Audit responsive behavior and accessibility

**Files**

- Modify shell/files/shared UI components
- Modify: `src/renderer/styles/index.css`
- Test: `src/tests/unit/responsiveShell.test.tsx`
- Test: `src/tests/unit/keyboardScopes.test.tsx`

**Steps**

- [ ] Audit the implemented thresholds from Tasks 5 and 11: wide at ≥1200 px,
      medium at 800–1199 px, and narrow below 800 px.
- [ ] Verify wide uses ~220 px sidebar + primary surface of at least 560 px +
      optional 320–360 px inspector.
- [ ] Verify medium overlays the inspector and narrow, including 640×480,
      overlays both sidebar and Quick Preview with secondary actions in
      overflow.
- [ ] Preserve minimum widths in the existing BrowserWindow bounds contract.
- [ ] Verify the tree and details/gallery ARIA patterns chosen in Task 3,
      including `aria-multiselectable`, one focus owner, focus fallback, tab
      order, Escape ownership, and focus restoration.
- [ ] Require WCAG AA 4.5:1 for body/control text and 3:1 for large text, icons,
      focus indicators, and meaningful boundaries.
- [ ] Verify truncation tooltips and 200% zoom behavior.
- [ ] Audit reduced motion.
- [ ] Ensure title-bar drag regions never swallow controls.
- [ ] Use component tests for behavioral mode switches; do not assert pixels.
- [ ] Manually verify actual window resizing.
- [ ] Commit: `feat(ui): adapt workspace and complete accessibility pass`

**Acceptance**

- Every supported window size has one obvious primary surface.
- Keyboard use never depends on hidden focus or competing global listeners.

---

### Task 18: Remove transitional shell code and contain Notes internals

**Files**

- Delete: `src/renderer/features/navbar/` after all imports are gone
- Delete/retire: old shared HTML context menu if no live consumer remains
- Delete/retire migrated shared-component duplicates
- Modify: `src/renderer/App.tsx`
- Modify: command IDs/menu template as needed
- Modify tests referencing removed shell

**Steps**

- [ ] Remove `Navbar`, route switch, and magic top margin.
- [ ] Remove unused `isBottomPaneOpen` and pane preferences not connected to a
      live surface.
- [ ] Remove `/files` code paths superseded by FilesRoute/DirectoryView.
- [ ] Keep the existing Notes implementation behind one explicit route and the
      shared `Notes` sidebar label.
- [ ] Apply the Gate 3 decision for first-run/default route; preserve last-used
      route for existing users.
- [ ] Do not leak legacy stores into global navigation, title bar, or commands.
- [ ] Remove raw palette classes from the new shell, `/files`, Command Menu,
      dialogs, and Settings.
- [ ] Confirm only one tooltip/menu/dialog implementation remains for new code.
- [ ] Remove unused `GlobalStyles`/styled-component primitives and the
      `react-icons` dependency only after an import check confirms no live
      consumer remains.
- [ ] Run dead-code/type/import checks.
- [ ] Commit: `refactor(ui): remove transitional application shell`

**Acceptance**

- New and old shells do not coexist.
- The legacy Notes implementation is contained and can be retired later without changing the
  global shell again.

---

### Task 19: Final performance and product verification

**Files**

- Update: `docs/superpowers/plans/baseline-linear-inspired-ux.txt`
- Update tests/performance marks only if measurement coverage—not budgets—is
  missing.

**Automated verification**

- [ ] `npm test`
- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `npm run test:e2e`
- [ ] Confirm no E2E or visual-regression test was added for appearance.
- [ ] Confirm no new TypeScript error beyond the recorded legacy baseline.
- [ ] Confirm 5,000-entry sort/filter/view-derivation and flattened-tree pure
      budgets.
- [ ] Confirm IPC contract after context-menu work.

**Manual verification**

- [ ] Cold light launch, cold dark launch, system-theme change, relaunch.
- [ ] Native traffic lights, drag regions, full screen, minimize/restore.
- [ ] Sidebar and inspector state restore without flash.
- [ ] Browse/Peek/Focus at 1440 × 900, 1024 × 700, 640×480, and 200% zoom.
- [ ] Open large folder; switch details/gallery; filter and sort rapidly.
- [ ] Keyboard-only: Command Menu, local search, filter, display options,
      selection, multi-selection, rename, Quick Preview, open, close, Back.
- [ ] Pointer: single/double click, range selection, context menus, drag/drop,
      pane resize.
- [ ] File modalities: directory, markdown, text, image, PDF, audio, video,
      unsupported file.
- [ ] Empty/loading/error/permission/stale-path/partial-batch states.
- [ ] Compare final shell to recording timestamps:
  - 00:04 — split queue/detail grammar
  - 00:08 — focused content + property rail
  - 00:20 — dense structured details
  - 00:25 — filter
  - 00:27 — display options
  - 00:29 — contextual inspector
  - 00:38 — long-form scroll with stable context
- [ ] Record after screenshots locally and review side by side; do not add
      screenshot assertions.
- [ ] Record medians from renderer marks:
  - cached browse/focus navigation intent → paint ≤50 ms
  - received 5,000-entry listing → first meaningful paint ≤150 ms
  - loaded inspector open → usable paint ≤100 ms
- [ ] Verify pure selection reducer work stays <4 ms and visible selection
      feedback arrives by the next animation frame.
- [ ] Commit: `docs: record linear-inspired UX verification`

**Final acceptance**

- Opal feels like one product in every live route.
- The resemblance to Linear comes from hierarchy, continuity, density, and
  interaction—not copied decoration.
- Filesystem behaviors remain native and predictable.
- No planned UI is backed by fake data or dead actions.

---

## Recommended execution order

Do not parallelize tasks that rewrite the same shell/files surface.

Safe parallel work:

- Task 1 token definitions and Task 3 pure store design can be developed in
  separate worktrees, then integrated before Task 5.
- Main-process capability portions of Task 14 can run after the Task 3 state
  contract is settled and in parallel with Task 11/12 renderer work.
- Settings Task 16 can begin after Tasks 1–6 stabilize shared primitives/shell.

Everything else should proceed in plan order. Visual review gates are product
decisions, not optional QA.

---

## Expected risk concentration

| Area | Risk | Mitigation |
|---|---|---|
| Selection state split | Existing tests and components assume one `selectedPath` | Land pure store transitions first; adapt components after tests define semantics |
| Shell cutover | Native drag region or first-paint layout can regress | Reuse native-shell foundation; real Electron check at Gate 1 |
| Virtualized density | Resize/column changes can overlap or lose scroll | Keep react-window; measure container; behavior tests plus large-folder manual pass |
| Shortcut centralization | Editor, dialogs, list, and app commands can compete | Explicit scopes and availability; one shortcut manager; focus tests |
| Inspector responsiveness | Three panes can crush content at small widths | Explicit wide/medium/narrow modes; overlay inspector below threshold |
| Context-menu plan drift | Old plan names today's components | Preserve capability architecture; wire only after redesigned surfaces exist |
| Notes internals | Two UI systems can remain visible indefinitely | Contain the legacy implementation under one route; remove its global-shell ownership; schedule disk-native editor separately |
| Router authority | Shell and files history can diverge | React Router owns route history; files locations use the same router contract |
| Path identity | Rename/move can strand state across stores | One tested subtree-remap coordinator; conservative clearing for ambiguous external events |
| Visual subjectivity | A long implementation can drift from the desired feel | Three mandatory review gates using the supplied recording |
