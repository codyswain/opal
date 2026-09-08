# Native Files: interaction, context menus, and the Linear toolbar

Date: 2026-09-08. Branch `codex/core-ux`.

## Why

Opal's folder browsing still behaves like a web list: double-click to open, no right-click, and a
folder's filters live on a separate "draft view" page with a three-row header. Bastion's Episodes
page (the reference the owner named) reads as one toolbar: **Filter** with inline chips on the
left; **count · layout · Display · Views** on the right. Every list is that toolbar. A saved view
is just a named toolbar state.

## Interaction model (Cursor / Finder blend)

- **Single click opens.** A file opens as a *preview tab* (italic, replaced by the next single
  click); a folder opens in place. Double-click, Enter-to-open (⌘↓) or editing the file pins the
  tab. ⌘-click and ⇧-click select without opening; right-click selects the row under the pointer
  when it is not already selected.
- **Keyboard stays Finder's:** arrows move selection, Enter renames, ⌘↓ opens, ⌘↑ goes up,
  ⌫ trashes, Space Quick Looks, ⌘A selects all.
- **Right-click on a row:** Open · Quick Look · Rename… · Move to… · Reveal in Finder · Open in
  default app · Copy path · Move to Trash (bulk when several are selected).
- **Right-click on empty space:** New folder · New note · Reveal folder in Finder.

## The toolbar (every collection)

`[breadcrumb / view name]  [Filter ▾][chip][chip] ……… [count] [≡ ▦] [Display ▾] [Views ▾]`

- **Filter** opens a menu of axes (Kind, Tags, Name, Modified, Opened, Description). Choosing one
  adds a chip; chips edit inline (the existing chip editors). In a folder, the first chip switches
  the list from the plain listing to a collection query scoped to that folder; clearing the chips
  returns to the listing. No navigation, no draft URL.
- **Display** holds layout-only choices: sort field and direction, density, include subfolders
  (folders only), show tags.
- **Views** lists saved views (this folder's first), with **Save current as view…** (name
  pre-filled from the definition), rename and remove. Opening a view navigates to its route as
  today; a view's page wears the same toolbar with **Save changes / Reset** appearing when edited.

## Out of scope

Board layouts, column configuration, shared/multi-user views, and content search in the toolbar.

## Delivered (2026-09-08)

Commits `a5aa3df` (interaction and context menus), `df6fb88` and `d402a0c` (the toolbar).

- Single click opens; ⌘/⇧-click select; right-click menus on rows and empty space with Rename, Move to…, Reveal, Copy path, Move to Trash (bulk over a selection); preview tabs pinned by editing, the tab, or Open.
- `ListToolbar` wears every folder and view: New · Filter + chips … layout · Display · Views · Preview. A folder's chips run a collection query scoped to the folder in place; Views saves that state with a suggested name; Display holds sort (incl. size and kind), density, Include subfolders and a view's scope.
- Layout lives only in the toolbar; the status bar keeps counts. A filtered folder with no direct matches offers "Search subfolders too".

Evidence: 941 unit and contract tests in 96 files, 0 type errors, 0 lint errors, 8 Electron tests; both screenshot tours clean in light and dark. The previous quick-filter box and "Filter this folder" button are gone; Cmd+F adds a Name chip.
