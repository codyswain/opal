# Saving, sync and the phone

Date: 2026-10-28. Status: proposal for Cody. This document covers what
`2026-10-28-pages-first-ux.md` leaves out: sync, version history and the
phone.

The research tested the build at `be2e0ff`. Tonight's branch
`simplify/editor-cm6` (`5d7af6d` and `fd993df`, 21:56) already fixes several
of the problems in section 3. I read its code and commit messages. I did not
re-run the tests against it.

## 1. The recommendation

1. Typing saves to the .md file within a second, and at least every 5 s while you type. A local journal holds anything not yet written, so a quit, a crash or a closed tab loses nothing.
2. Agent appends and edits from other devices merge into the open page and the cursor stays put. Opal asks only when both sides changed the same lines, and it keeps both versions.
3. Every page has History (time, machine, diff, Restore). Git holds the versions, plus a snapshot Opal takes before every merge.
4. Sync stays plain files and git, run by one fixed script that commits before it merges. Opal runs it, so your edits leave the Mac within a minute.
5. On the phone, a Home Screen web app called Pages, served by the Mini over Tailscale, edits the Mini's copy with the same editor and rules. No git and no App Store build to start.

## 2. How it works

This follows Google Docs and Obsidian Sync, cut down to plain files. Each
editor remembers the version it started from (the base). A save sends the new
text with that base, and the writer merges against it rather than asking you
to pick a winner. History is kept apart from sync. The apps people trust least
make you pick a whole version: iCloud, iA Writer
(https://ia.net/writer/support/help/icloud), Bear
(https://bear.app/faq/how-bear-pro-handles-conflicted-notes) and Dropbox
conflicted copies (https://help.dropbox.com/organize/conflicted-copy).
Obsidian Sync merges Markdown three ways and keeps version history
(https://obsidian.md/help/sync/troubleshoot,
https://obsidian.md/help/sync/version-history).

### Autosave on the desktop

Already on `simplify/editor-cm6`:

- CodeMirror 6 edits the file text itself, and a save writes only the changed span. The branch's census found all 2,779 vault .md files round-trip byte for byte.
- A save runs 800 ms after the last change, and at least every 5 s while typing. Blur, Cmd+S, leaving the page, closing the window and quitting all flush it (`src/main/window/PendingSavesGuard.ts`, which waits at most 3 s).
- A disk change reaches a clean page as a minimal edit, so the cursor, scroll and undo stay.
- The Activity Log section of `Inbox/Logs/*.md` is read-only in Opal.

Still to add:

- **Journal.** The main process writes each dirty page's unsaved text and base to `~/Library/Application Support/Opal/pending/<hash>.json` at most every 250 ms (temp file, fsync, rename). A save that covers the text deletes it, and launch replays anything left through the merge. This covers a crash, a force quit, the 3 s guard giving up and a failed write. `docs/persistence.md` already has a `journal-drafts` folder in the profile for the same kind of data.
- **Append-safe write.** `src/main/fs/MarkdownDocumentService.ts` re-reads the file and then renames over it. An agent's `>>` append that lands between the two goes into the file the rename throws away. The fix: keep the old file open across the rename, then copy any bytes appended to it onto the new file. In the scratch stress test, the current code lost 14 to 29 appends per run and the fixed version lost 0 of 844.
- **Stable read.** Before a merge, re-read until size and mtime hold steady for about 200 ms. Refuse a clean merge that deletes a large unchanged span on the disk side. Pocket writes notes in place with `open(path, "w")` (`~/code/vault/.claude/connectors/pocket/pocket_sync.py:431` and `:581`), so a reader can catch half a file. In a test, a merge against half a daily log kept 28,908 of 57,791 bytes and reported no conflict. Change those two lines to temp file plus rename as well.
- **Ignore temp files.** Add `.opal-edit-*` to the vault `.gitignore`, because `vault-push.sh` runs `git add -A`.

### Conflicts, and agents appending while you type

The common case: you type under Morning while agents append to the Activity
Log 10 to 200 times an hour. The two touch different lines, so the branch's
line merge (`mergeText.ts`, base = last saved text) combines them with no
prompt. The new line appears at the bottom and the cursor stays. Opal cannot
edit the Activity Log section, so this case never conflicts.

A real overlap, where both sides changed the same lines, is rare. While the
page is open, keep the branch's pick for each change. Change one thing: if the
page closes with a pick still open, write it into the note as a callout,
not into a separate "(conflicted copy)" file.

```markdown
> [!conflict] Other version (Mini agent, 10:02)
> the other side's lines
```

Your text stays in place and the other version sits right under it. You
delete the one you don't want. Obsidian shows the same box. The git merge
and the phone server use the same format, since they have no screen to ask
on. Opal takes a snapshot before writing it.

Rules by kind of file:

- **`Inbox/Logs/*.md`, Activity Log.** Keep every added line, drop exact repeats and sort by HH:MM. When two machines create the same day, merge against `~/code/vault/Archive/Journal/Template.md`, not an empty file. I replayed all 31 real log merges since Sep 1 with this rule: 0 lines lost and 0 out of order. Today's union merge put 45 pairs out of order.
- **`Library/chats/` and `Inbox/Recordings/`.** One machine owns each file, so the newer side wins with no callout, and history keeps the older one. A callout would stop Pocket from updating the note (`pocket_sync.py:306-309` checks `sync_hash`).
- **Everything else.** Three-way line merge, with a callout on overlap.

Obsidian is one more writer of plain files and needs no changes. One risk
remains: unsaved typing in the same note in Opal and Obsidian at once.

### Version history

- Every page has a History button. The rows come from `git log --follow -- <path>`, with "Now" and "Not synced yet" at the top. Each row shows the time, the machine and the lines added and removed. Clicking a row shows the old text read-only with a diff against now. Restore saves the old text as a new version, so a restore can be undone too.
- Opal and Pages commit the paths they saved first (`opal: <path> (pro)`, `pages: <path>`), before the script's general `git add -A`. That lets History tell your edits apart from agent auto-sync.
- Before every merge, callout or restore, Opal keeps the base, its own text and the disk text for 7 days. It copies the depmap store pattern (`~/code/vault/.claude/apps/depmap/server.py:91-127`). These snapshots make automatic merging safe: you can undo a bad merge even when git never saw the state before it. The "Merged" notice has an Undo.
- Git keeps everything. All 1,973 stored versions of the daily logs take 6.1 MB packed.
- History has one version per sync (about a minute), not one per keystroke.

This replaces Tier 2 of the persistence plan in
`2026-09-11-basecamp-in-opal-handoff.md` section 9.

### Sync between the Macs and the Mini

Today the vault syncs through git and GitHub. A pull runs when you prompt an
agent and a push when the turn ends (`~/code/vault/.claude/settings.json:31-91`).
Opal and Obsidian never commit. The Mini sees other machines' commits in a
median of 4.2 min. The Pro takes a median of 24 min, and 3.3 h at p90.

The change:

- One script, `.claude/hooks/vault-sync.sh`, replaces `vault-pull.sh` and `vault-push.sh`. It takes the sync lock, commits local changes and fetches. Then it merges `@{u}` under the write lock, with no autostash and no stash pop. It pushes, merging and retrying once if the push is rejected. Each run appends its result to `.claude/state/sync.log`.
- Every caller uses it: the Claude hooks, the Codex hooks, `pocket_sync.py:591-595`, meet sync, `routine-preflight.sh:48`, Opal and Pages. The Codex hooks become symlinks; `.codex/hooks/vault-pull.sh:7` is a stale `--ff-only` copy today.
- Opal runs the script 60 s after the last save, on leaving a page, on Cmd+S, on window focus and every 5 min. It does not run it during quit, because the journal covers quit. The status bar says "Synced 2 min ago" or "Sync failing: reason".
- The write lock lives in `.claude/state/locks/` (gitignored), not in `.git`, because Codex's workspace-write sandbox makes `.git` read-only. Opal's save, `vault-append-log.sh`, `vault-daily-log.sh:65` and `vault-daily-ensure.sh` take it. The append-safe write covers the writers that don't.
- Commit messages name the machine: `vault: auto-sync 2026-10-28 21:32 (pro)`.
- `.gitattributes` keeps `merge=union` until the log merge driver passes the replay test.

Why commit before merging? Today, `git pull --autostash` exits 0 when an
uncommitted edit overlaps an incoming change, but it leaves conflict markers
in the note. The next Stop hook then commits and pushes them. A later failed
pull can pop a days-old stash onto newer text (`vault-pull.sh:16`). I
reproduced both on scratch clones with the real hooks, though neither has
happened in the live vault yet. Committing first also ends the most common
pull failure on the Pro: "untracked working tree files would be overwritten"
on today's log (14 of 26 failures, Oct 16 to 28).

### The phone

- **Address.** `https://codys-mac-mini-1.tail51bb4a.ts.net:8443/`, added to the Home Screen. It is set up with `tailscale serve --bg --https=8443 http://127.0.0.1:47820` (port 47820 is free) and runs as launchd agent `local.opal-pages`. An install script modelled on `~/code/vault/.claude/apps/depmap/install.sh` sets it up. Its own port gives it its own origin, so a script bug in the hub, /map or /learn cannot call its write API.
- **Sign-in.** There is none. It copies depmap's `allowed()` (`server.py:296-309`): `Tailscale-User-Login` must be you, and writes must carry the page's Origin. Serve strips forged identity headers (https://tailscale.com/kb/1312/serve). The owner check is required because john@ is on the tailnet. VPN On Demand turns Tailscale on when the app opens (https://tailscale.com/kb/1291/ios-vpn-on-demand).
- **Server.** Node 22. It reuses `MarkdownDocumentService` and `RootRegistry`, which have no Electron imports; a 278 KB esbuild bundle of them ran in the scratch test. It writes to the Mini's working copy, which is the freshest copy. It needs about seven calls:
  - tree, read, create and search
  - save `{path, base, text}`, which merges and returns the merged text
  - today, which creates today's log on the server so the phone never races it
  - history

  It uses the same lock, merge rules and sync script as desktop. It is installed from the Opal repo with an explicit step, never run live from the vault checkout it pulls into.
- **Client.** It uses the branch's CodeMirror editor, so the phone also changes only the lines you type. The read view uses react-markdown, remark-gfm and rehype-sanitize, all already Opal dependencies. Sanitizing matters because notes hold email and Slack text. Screens: Today, Recent, Search, Page, History.
- **Saving on iOS.** Unsent text goes to IndexedDB on every change, and the app calls `navigator.storage.persist()`. It sends 800 ms after typing stops, at least every 5 s, and on `visibilitychange`. iOS does not fire `pagehide` reliably (https://bugs.webkit.org/show_bug.cgi?id=199854), so the IndexedDB copy is what protects the text. If the Mini can't be reached, a "Not saved: Mini unreachable" banner stays up and the text is resent on the next open. v1 works only online.
- **Links.** On an iPhone, the hub's `/o/<path>` redirect (`~/code/vault/.claude/connectors/mcp/hub.py:589-595`) goes to Pages instead of `obsidian://`. Vault links that agents already post in Slack and digests then open on the phone.
- **Native later.** A Capacitor wrapper of the same build, when you want a share sheet, widgets or storage iOS can't clear: 2 to 4 days plus the $99 a year developer account. A SwiftUI app (3 to 6 weeks) only if the web editor feels bad.

## 3. What breaks today

Ranked by how likely and how bad. "Branch" means `simplify/editor-cm6`.

1. **The first real edit rewrites the whole file.** On a round trip, 1,883 of 1,942 tracked vault files change. Wiki links are escaped in 564 files and 153 of 155 `[!ai]` callouts break. Images, reference links and `obsidian://` links are deleted; `Library/personal/skin.md` loses all 25 photos. *Fixed on the branch.*
2. **Quitting within 800 ms of typing loses the text.** 12 of 12 trials lost it in the built app, because `before-quit` does not wait (`src/main.ts:509` at `be2e0ff`). *Fixed on the branch by `PendingSavesGuard`.*
3. **Any outside write during unsaved typing becomes a whole-file conflict, and both buttons throw one side away.** "Keep mine" deletes the agent's lines, and "Reload from disk" deletes your typing (`EditorStatus.tsx:39-44`). On the daily log this happens all the time. *Mostly fixed on the branch by the line merge. Real overlaps still go to a pick.*
4. **Leaving a page that is in conflict drops the typing with no prompt.** Closing the tab, quitting and Cmd+R all do it (`useMarkdownDocument.ts:158-166` at `be2e0ff`). *Fixed on the branch with a conflicted copy. Step 2 changes the copy to a callout.*
5. **Unsaved text has no durable copy.** A crash, a force quit or the guard's 3 s timeout loses up to 5 s of typing. *Open. Step 2.*
6. **`git pull --autostash` can commit conflict markers.** It exits 0 with markers in the note, and the next Stop hook pushes them. A stale stash can also pop onto newer text (`~/code/vault/.claude/hooks/vault-pull.sh:14-16`). Both reproduced on scratch clones. *Open. Step 3.*
7. **A torn read becomes a deletion.** Pocket writes notes in place, so a merge can run against half a file and silently drop the rest. This affects any design that merges. *Open. Steps 1 and 2.*
8. **An agent's append can vanish with no conflict.** It happens when the append lands in the roughly 1 ms between Opal's re-read and its rename. A stress test lost 50 of 375 appends. In normal use the estimate is 1 in 1,000 to 1 in 10,000 appends while you type in the log. *Open; the branch still renames. Step 2.*
9. **Union merge duplicates prose and puts log lines out of order.** The same line edited on two machines comes out as two lines with no conflict. `Inbox/Logs/2026-10-28.md` has 08:50 lines before 06:38. *Open. Step 6.*
10. **Laptops run behind.** The Pro sees other machines' commits in a median of 24 min (3.3 h at p90). Opal edits leave the Mac only when an agent turn ends. *Open. Steps 3 and 5.*

Smaller issues:

- `.opal-edit-*` temp files are not gitignored.
- The Codex hook copies are stale.
- `vault-stop.sh:21` swallows the push script's errors, so sync failures don't show anywhere.

## 4. Build order

Each step ships on its own. Effort assumes agents do the work and you test.

1. **This week: land the branch and close the cheap holes (1 day).**
   - Merge `simplify/editor-cm6`.
   - Re-run the research scenarios against it: quit, append while typing, leave while in conflict, cursor jump, append race. The scripts are in `/private/tmp/claude-501/-Users-cody-code-vault/bb1d9d8e-ea7d-475e-918b-8615e5b1e550/scratchpad/sync/` for now.
   - Add `.opal-edit-*` to the vault `.gitignore`.
   - Make `pocket_sync.py:431` and `:581` write a temp file and rename it.
   - Free space on the Mini. Its data volume has 2.4 GiB free (99% used, checked tonight), and every write path on the Mini fails when it fills.
2. **Never lose typed text (1 to 2 days).**
   - The main-process journal, replayed on launch.
   - The append-safe write and the stable-read guard.
   - A snapshot before every merge.
   - The conflict callout in place of the conflicted-copy file.
   - Test: `kill -9` while typing loses at most 250 ms, and the append race loses 0 lines.
3. **One sync script (1 day).**
   - `vault-sync.sh`, with its lock in `.claude/state/locks/` and `sync.log`.
   - The machine name in commit messages.
   - Codex hooks as symlinks.
   - Test: the autostash repro leaves no markers and no stash.
4. **Pages on the Mini (3 to 4 days).**
   - The server and the phone client.
   - The IndexedDB journal and the server-created daily log.
   - Git-log history with Restore.
   - The hub `/o/` redirect.
   - After this step you can read and edit the vault on your iPhone.
5. **Opal syncs and shows history (2 days).**
   - Opal runs the sync script and shows "Synced N min ago".
   - The History panel and Undo merge.
   - Opal commits its own paths as `opal: <path> (pro)`.
6. **Log merge driver (1 day).**
   - Union, HH:MM sort and the template base for `Inbox/Logs`.
   - Newer wins for chats and recordings.
   - Switch `.gitattributes` only after it passes the replay of the 31 real log merges.
7. **Later, if wanted.** The Capacitor wrapper (2 to 4 days, $99 a year).

Steps 1 to 6 take about two weeks. The phone works after about a week and a
half.

## 5. Alternatives considered

Two judges scored three designs out of 10. One judge focused on data safety,
the other on the product. Higher is better. A higher effort score means less
work. Each cell shows safety judge / product judge.

| Design | Simplicity | Data safety | Agents and Obsidian | Phone | Effort |
|---|---|---|---|---|---|
| Plain files and git, made safe (this plan) | 7 / 8 | 6 / 7 | 8 / 8 | 6 / 7 | 7 / 7 |
| Mini as source of truth | 4 / 5 | 7 / 7.5 | 4 / 4 | 8 / 8 | 4 / 5 |
| vaultd, local-first relay | 2 / 5 | 6 / 6 | 6 / 6 | 8 / 4 | 2 / 2 |

The plan above already includes the judges' fixes for the holes behind its
data-safety score: the torn read, the lock location, the unlocked appends and
the add/add merge.

**Mini as source of truth.** Every editor, Opal on the laptops included,
would save through a server on the Mini. The server would merge, keep every
version and run git. It has the best history (every version, labelled by
source) and the best phone. It breaks the laptop, though. Opal would write
only to the Mini, while Obsidian, grep and laptop agents read the laptop
folder. The same note would show different text in Opal and Obsidian on the
Pro until the Mini pushed and the Pro pulled. With the Mini down, Opal text
would sit in a journal no agent can read. All history would live on one disk
that is 99% full. This plan takes the server-created daily log, installing
from the Opal repo, and the status words from it.

**vaultd, local-first relay.** A daemon on every Mac would sync files live
through a relay on the Mini. The relay would order and merge every change and
be the only git committer. Its merge rules are the best of the three, and this
plan uses them: the log rule, the template base, the append-safe write and the
stable-read guard. As a whole it is the biggest build: 6 to 9 weeks, with the
phone last and laptop git turned into a read-only mirror. The safety judge
found a sequence where vaultd and Opal lose typed text with no copy anywhere,
because they are two whole-file writers on one Mac with no shared lock. A bad
write, such as a truncated Pocket note or an agent's `git checkout`, would
reach every Mac in about 2 seconds.

**A CRDT (Yjs, Automerge).** It merges two people typing in the same paragraph
at once, which rarely happens here. Every writer in the vault writes whole
files: bash `>>`, the Claude and Codex Edit tools, Obsidian and Pocket. A CRDT
would have to diff each disk write back into its own operations. Relay, the
Yjs plugin for Obsidian, does exactly that and still ships a three-way merge
with conflict regions (https://github.com/No-Instructions/Relay). Revisit it
only if live co-editing becomes a need.

**Git on the phone.** This means Obsidian iOS with obsidian-git, or Working
Copy. It brings git conflicts to the phone and adds a fourth git writer.
obsidian-git calls its own mobile support "very unstable"
(https://github.com/Vinzent03/obsidian-git, https://workingcopy.app/manual).

## 6. Open questions

1. Does the phone need to work offline, on a plane or in Kigali, or is online only fine for v1? Offline reading and queued edits add 2 to 3 days.
2. The Mini has 2.4 GiB free. Do you know what can go, or should an agent look for space (caches, old builds) and bring you a list?
3. Will you keep editing in Obsidian once Opal works on the vault? If so, Opal should warn when the same note has unsaved typing in both, because that is the one case the merge can't cover.
