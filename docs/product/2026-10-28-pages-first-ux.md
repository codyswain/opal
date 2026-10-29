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
┌──────────────────────┬──────────────────────────────────────────┬──────────────────────┐
│ ● ● ●  ▢  ‹  ›       │ [tab] [tab] +       [ Search ⌘K ]        │ Wed, Oct 28  ‹ › ⋯ ▢ │  one 40px row
│                      ├──────────────────────────────────────────┼──────────────────────┤
│ Today                │                                          │ Activity log      22 │
│ Recent               │     Page title                           │ Chats     4 new · 14 │
│                      │                                          │ Recordings         4 │
│ ▸ Archive            │     Body text in a centered column ...   │ Digest             8 │
│ ▾ Library            │                                          │                      │
│   ▸ daily            │                                          │                      │
│   ▸ logs             │                                          │                      │
│ AGENTS               │                                          │                      │
│ README               │                                          │                      │
│                      │               2 properties · 1,204 words │                      │
│ ⚙ Settings           │                                          │                      │
└──────────────────────┴──────────────────────────────────────────┴──────────────────────┘
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
- When the right sidebar is hidden, its toggle (panel-right) sits at the
  row's right end.

### Right sidebar

One day of the vault beside the page: its activity log, chats, recordings and
digest. Code: `src/renderer/features/day-sidebar/`. Data: `vault:day`.

- About 300px wide (260px below 1200px), resizable from 240px, as a column of
  hairline cards on the chrome ground. Its header shares the 40px top row:
  the day ("Wed, Oct 28", then "Yesterday" or "Today"; below 280px the
  weekday goes), previous and next day, the options menu and the toggle.
- Toggle: the panel-right button or View > Toggle Right Sidebar
  (Cmd+Shift+\). Below 1000px only one sidebar stays open, so opening one
  closes the other.
- Which day: a dated page (a daily page, a log, a recording or a digest) sets
  the day. Any other page keeps the last day shown. With nothing set, it
  shows today. The arrows pick a day until another page opens.
- The options menu has a check per section and Go to today. Opal remembers
  whether the sidebar is open, its width, the sections shown and the folded
  cards.
- At rest: the latest 3 log entries, 3 chats, 4 recordings and up to 3 items
  of the digest's top group, each card with "Show N more". The log ends with
  Open full log and the digest with Open digest. A full log of more than 40
  entries folds by hour. Log lines that only repeat a recording or the digest
  shown below are left out.
- A chat row or digest item opens its note. A log entry or recording opens in
  place, with the full sentence and every link; Escape closes it. Links open
  in the current tab and Cmd+click opens a new tab; external links open the
  browser. A file icon marks a vault link and an arrow marks an external one.
- A day with nothing shows one muted line instead of four empty cards. The
  cards read again when `vault:day-changed` says the day changed on disk.

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
  Back Cmd+[ and Forward Cmd+], Toggle Sidebar Cmd+\, Toggle Right Sidebar
  Cmd+Shift+\. Cmd+B stays bold.
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
  right-aligned. On a log page the line starts with "Read-only". The line is
  the properties toggle (below).
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

### Properties

A tucked-away view of a page's metadata, for the rare time it is wanted.

- The footer line is the toggle. It looks like plain muted text until the
  pointer is on it, and a click never takes focus from the text. View > Show
  Properties (Hide Properties while open, Cmd+Shift+I) does the same. Cmd+I
  stays italic and Cmd+Option+I the developer tools.
- The block sits under the inline title, in the small UI sans: the
  frontmatter keys and values, a hairline, then Path (from the top of the
  opened folder), Created, Modified and Size. `markdown:properties` reads them
  in the main process, the times and size from `fs.stat`. The word count stays
  in the footer.
- Read-only, like the rest of Opal's property handling. A value that is a
  wiki link, such as a chat session's `thread`, opens its note.
- Opening it scrolls the page to the top so the block shows; closing keeps
  the scroll. The same click, the menu item, or Escape while focus is in the
  block or on the footer line closes it. In the text, Escape belongs to the
  editor.
- It stays open from page to page until it is closed or Opal quits. It is
  never saved.
- It is read again after each save and after a change in the page's folder,
  so Modified and Size stay current.

## Out of scope here

Sync across machines, version history, the phone version (see
`2026-10-28-saving-sync-and-phone.md` when it lands) and the Dock icon.

## Definition of done

`npx tsc --noEmit` clean, `npm test` green, `npm run test:e2e` green,
`npm run lint` with no errors, and screenshots of the window, Today, Recent,
the tree with files, a page with callouts and lists, the right sidebar, the
properties block, and Settings, in light and dark.
