# Pages first: the Opal UX overhaul

Date: 2026-10-28. Status: decided. This is the product authority for the
overhaul. Read it before touching the shell, the sidebar, tabs or the editor.

## Why

Cody, on the current app: "the UX of this app is really super mid", "so much
friggin' visual clutter", "it feels like an Electron slop app", "the tabbing
doesn't work well and doesn't feel native on macOS". The bar is the Claude
desktop app, Obsidian (which he uses daily), Linear and Bastion. Pages come
first: a file tree on the left and one clean page.

## The window

```
┌──────────────────────┬──────────────────────────────────────────────────┐
│ ● ● ●  ▢  ‹  ›       │ [tab] [tab] [tab] +     [ Search ⌘K ]            │  one 40px row
│                      ├──────────────────────────────────────────────────┤
│ Today                │                                                  │
│ Recent               │     Page title                                   │
│                      │                                                  │
│ ▸ Archive            │     Body text in a centered column ...           │
│ ▾ Inbox              │                                                  │
│   ▸ Logs             │                                                  │
│   inbox note         │                                                  │
│ ▸ Library            │                                                  │
│ AGENTS               │                                                  │
│ README               │                                                  │
│                      │                                    1,204 words   │
│ ⚙ Settings           │                                                  │
└──────────────────────┴──────────────────────────────────────────────────┘
```

### Sidebar

- Top row (40px, the window drag region): traffic lights, then the sidebar
  toggle, back and forward. Back and forward live here and nowhere else.
- No "Opal" workspace button, no "Open folders" heading, no open-folder
  buttons. Opening another folder stays in Settings only.
- Nav: **Today** (opens `Library/daily/YYYY-MM-DD.md`, creating it from the
  template if needed; the main process returns the path) and **Recent**. No
  Library item. No Views. Until the cleanup commit, Today opens an existing
  `Inbox/Logs/YYYY-MM-DD.md` when the daily page does not exist.
- Under the nav, after some space and no rule: the vault's files. With one
  opened root, the root is not a row; its children start at the top level and
  it is always open. With several roots, each root is a top-level row, open
  by default.
- The tree lists files and folders, folders first, then files, by name with
  numeric collation. Dotfiles and `.opal.yaml` carriers stay hidden (the main
  process already filters them). Markdown labels drop `.md`.
- Clicking a folder expands or collapses it; it never navigates. Clicking a
  file opens it in the current tab; Cmd+click or middle-click opens it in a
  new tab. Keyboard follows the WAI-ARIA tree pattern (Up/Down, Left/Right,
  Enter, Home/End).
- The open file is highlighted. When a file opens from outside the tree
  (Today, Recent, search, a link), its folders expand and it scrolls into view.
- Expanded folders persist across launches.
- File actions live on the tree now that the folder view is gone: a right-click
  menu on rows (New note, New folder, Rename, Move to…, Reveal in Finder, Copy
  path, Move to Trash with confirmation), inline rename, drag a row onto a
  folder to move it, and Cmd+N for a new note in the active file's folder
  (the vault root when nothing is open).
- Footer: Settings only (no theme toggle; theme lives in Settings).
- Default width about 260px, resizable.

### Top row of the main column

- One 40px row: compact rounded tab pills, a `+` button, and a small search
  field centered in the row ("Search ⌘K") that opens the palette. Nothing
  else: no title, no privacy shield, no breadcrumb row, no "Return to folder".
  Empty space in the row drags the window.
- When the sidebar is hidden, the row leaves room for the traffic lights and
  shows the sidebar toggle, back and forward at its left.

### Tabs (Obsidian and Safari semantics)

- A plain open (tree click, Recent click, palette Enter, Today) replaces the
  file in the current tab. Cmd+click, middle-click, Cmd+Enter in the palette
  and Cmd+T then a pick open a new tab.
- No preview tabs, no italic state, no pin-on-double-click.
- Each tab has its own back/forward history. Switching or closing tabs is
  never a history step.
- Native menu items with standard shortcuts, so they work while the editor
  has focus: New Tab Cmd+T, Close Tab Cmd+W (closes the window when no tab is
  left), Reopen Closed Tab Cmd+Shift+T, Show Previous/Next Tab Cmd+Shift+[ / ]
  and Ctrl+Shift+Tab / Ctrl+Tab, Cmd+1..8 by position and Cmd+9 for the last,
  Back Cmd+[ and Forward Cmd+], Toggle Sidebar Cmd+\. Cmd+B stays bold.
- Tabs keep their scroll position. The window title is the active file name.
- Open tabs restore on relaunch. Launch opens Today only when no tabs were
  restored or the date changed since the last session.
- Same-name tabs show their parent folder in muted text; the tooltip is the
  vault-relative path.

### Recent

- A page with one plain list of recently opened or edited files (no folders),
  grouped by day: Today, Yesterday, Previous 7 days, Earlier. Capped at 30 days.
- Row: title without `.md`, the vault-relative folder in muted text, the time
  on the right. Click opens in the current tab, Cmd+click in a new tab.
- No filter input, no layout toggle, no preview toggle, no status bar.
  Clearing history moves to Settings.

### Removed

- Views (done in the first commit of this overhaul).
- The Library folder view and everything only it used: the folder toolbar
  (New, Filter, list/grid, Display, Views, Preview), the gallery grid, Quick
  Look, the Preview pane, the Details inspector (tags, description, Related)
  and its dead toggle commands. Tags and descriptions already stored in files
  stay untouched; Opal just stops editing them.
- The privacy shield and the privacy feature.
- The Titlebar route title, breadcrumbs and the focus header.
- The dead navigation-pane tree (DiskTree, DiskTreeItem).
- Non-Markdown files clicked in the tree open in a minimal viewer: images
  inline, PDFs embedded, other text as plain text, anything else with an
  "Open in default app" button.

### Settings

A modal dialog (Cmd+, and the sidebar gear): Appearance (theme), Folders
(opened roots, open another), Recent (clear history). Not a route.

## Look

**Black and white first (Cody, 2026-10-28):** "I don't think we should add in
any strong colors. I don't like how the tabs are purple and there are some sort
of purple highlights. We need to make sure the app looks beautiful with black
and white first before we branch out and add in any color." So the UI has no
hue anywhere. Every token is a neutral grey from white to black: no indigo,
purple, blue or any tinted accent, including focus rings, the caret, selection,
the active tab, links, checkboxes, toggles, buttons, callouts, badges, errors
and destructive actions. Emphasis comes from contrast, weight, size and
spacing. Links are text-coloured with a subtle underline. Focus rings are a
neutral dark ring in light mode and a neutral light ring in dark mode.
Errors and destructive actions use wording, weight and an icon, not red. The
only colour on screen comes from images inside notes. This overrides the
accent notes below.

Tokens follow the design brief from Bastion and Linear:

- UI font: Inter Variable, bundled (no network), 13px UI text, weight 510 for
  nav and active items, 400 for tree rows, sentence-case 12px labels, tabular
  numbers for dates and counts.
- One chrome ground for the sidebar and the top row (light #f4f4f5, dark
  #08090a). The page sits in it as a card (light #ffffff, dark #0f1011) with an
  8px radius and a 1px hairline ring, inset 8px on the right and bottom. No
  rules between sidebar parts or under the top row.
- Neutral hover and selection overlays (light rgba(0,0,0,.04) and .07, dark
  rgba(255,255,255,.03) and .04); no accent colour anywhere (see above).
- Rows 28px with a 6px radius and 2px gaps. Hover appears instantly and fades
  out over 150ms. Sidebar scrollbars show on hover only.
- Warmer, less saturated neutrals than today's blue-greys.

## The page

- The editor is CodeMirror 6 with live preview, like Obsidian: the file text
  is the document, so untouched bytes never change. Markers (`#`, `**`, `[[ ]]`,
  list markers) hide away from the cursor; bullets, checkboxes, headings,
  links, wiki links, callouts (including `> [!ai] AI`), images, code blocks,
  tables and horizontal rules render. TipTap and its round trip are removed.
- Callouts, including `> [!ai] AI`, render as neutral grey boxes (a light
  grey fill or a grey left rule and a bold title), never tinted, whatever the
  vault's Obsidian snippet uses.
- Reading font PT Serif (ships with macOS) at 16px with about 1.6 line height
  in a centered column of about 700px. Headings in the same serif, bold. UI
  stays Inter.
- An inline title (the file name) above the body. Frontmatter is hidden in
  the page; the footer shows "N properties · N words", muted and
  right-aligned.
- Spellcheck off. A page opens at the top without stealing focus, except an
  empty page, which gets the caret.
- Autosave: about 800ms after the last change, at most 5s while typing, and
  flushed on blur, tab close, window close and quit.
- External changes (agents append to today's log constantly) are applied to
  the open document as a text change, keeping cursor and scroll. When the
  page also has unsaved edits, merge three ways (base = last saved text). A
  clean merge is applied silently. A real conflict keeps both and asks.
- Every `Library/logs/*.md` page is read-only in Opal and always reads as
  rendered. Only the vault's scripts write it. Daily pages in `Library/daily/`
  are fully editable, even one that holds an `## Activity Log` heading. Until
  the cleanup commit, the `## Activity Log` section of an old
  `Inbox/Logs/*.md` page stays read-only.

## Out of scope here

Sync across machines, version history, the phone version (see
`2026-10-28-saving-sync-and-phone.md` when it lands) and the Dock icon.

## Definition of done

`npx tsc --noEmit` clean, `npm test` green, `npm run test:e2e` green,
`npm run lint` with no errors, and screenshots of the window, Today, Recent,
the tree with files, a page with callouts and lists, and Settings, in light
and dark.
