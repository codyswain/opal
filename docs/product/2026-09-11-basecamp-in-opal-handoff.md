# Basecamp in Opal: handoff

Date: 2026-09-11. Status: direction approved, design sections 1–2 approved,
sections 3–5 still to be designed. Nothing implemented yet.

This document is the product and design authority for the next piece of work.
It is written so a session on another machine can continue without this
conversation. Read it top to bottom before touching code.

## 1. Where the code is

- Branch `dev` in `codyswain/opal` is the integration branch and carries
  everything: `codex/core-ux` (Today, threads, search, recovery) was merged in
  with `fa04f22` on 2026-09-11. Work on `dev`, or on a branch cut from it.
- Baseline on `dev`: 1,079 unit and contract tests in 114 files, 0 type errors,
  7 pre-existing lint warnings, 8 Playwright tests in about 7 s. `npm test`
  needs no native rebuild.
- The installed app at `/Applications/Opal.app` was built from `bfb1ba7`.
  Rollback copies live in `~/Opal Backups/`. See `docs/local-app-install.md`.
- The current Basecamp lives in a separate repo at `~/code/basecamp` on the
  original machine. **It has no git remote**, so another machine cannot fetch
  it: before porting, either push it somewhere (`git remote add origin …`)
  or copy the checkout across. Slice 1 needs its source. It is small:
  about 1,200 lines of server (adapters 422, core 201, server 360, store 180),
  a 4,300-line React web client, 192 passing tests. Its state database is
  `~/.basecamp/basecamp.db`, last written July 2026, with no live snoozes or
  priority overrides, so there is nothing to migrate.
- The vault is `~/code/vault` (`git@github.com:codyswain/vault.git`), and it
  auto-commits and pushes every few minutes ("vault: auto-sync"). Opal's Today
  reads `Inbox/Logs`, `Inbox/Digests`, `RAM/todo.md`, `RAM/triage/state.json`,
  `Photos/`, `Archive/Journal/Template.md` from it. Basecamp's vault adapter
  scans `Inbox/` and `RAM/` and archives with `git mv` plus a commit.

## 2. Product direction (Cody's words, condensed)

- Opal is a place to streamline thought. Minimalism to an extreme: one
  primary object per screen, everything else one keystroke away. Functionality
  is available, never in the way. Build the perfect product for Cody first;
  no release considerations for now.
- **Threads are ideas, not chats.** A thread is a Markdown file you keep
  refining. You can optionally open a chat on it; that chat always has the
  file plus every file it references loaded whole into context, no retrieval.
  The thread *is* the file alongside the files it links to. The current chat
  feature (JSON conversations, retrieval per question) is the wrong shape.
- **Today is where you know what needs doing.** A Superhuman-grade feed:
  snooze, done, priority, keyboard-first, with email and calendar in it and
  writable (reply to email, modify events). The journal stays alongside as a
  quiet second surface. Files are fine as they are; they are how you navigate
  to threads and other things.
- **Opal is a generic client; the server is where integrations live.** Opal
  attaches to any server that speaks a shared protocol. The first server is
  named **Basecamp**, runs on a Mac mini on the home network reachable from
  anywhere (Tailscale), and owns the connectors (Linear, vault, Gmail, later
  Calendar, Slack, MCP servers) and the triage state. Client and server live
  in the Opal repo with instructions for both.

## 3. Decisions taken in this session

| Question | Decision |
|---|---|
| Where does task state live | On the server (Basecamp). Opal is a client. |
| Reach from other devices | Yes, via the Mac mini server. Opal is the only client for now; the old Basecamp web client is not ported and is retired once Opal reaches parity. |
| What "the to-do" is on Today | One feed of typed items from the server. Today's own daily-focus list, `todo.md` checkboxes, and triage suggestions are folded into feed items or retired in the feed slice. |
| Protocol style | **Approach A**: a typed feed protocol over HTTP plus SSE, server-owned state, declared per-kind actions. Not embedded adapters in Electron (B), not MCP as the wire protocol (C). MCP servers can be connectors inside Basecamp. |
| Order of work | Slice 1 first: protocol plus moving Basecamp into the repo. Then the feed in Opal, then rich kinds and actions, then threads as files. |

## 4. Slices (each gets its own spec and plan)

1. **Protocol + Basecamp in the repo.** This handoff's subject. Move the server
   in as `server/`, port the three adapters and snooze/done/priority state, add
   the manifest, typed item kinds, and the SSE stream. Bring the 192 tests.
2. **The feed in Opal.** Today becomes the feed: keyboard model from the
   Basecamp web client (j, k, e, z, p, snooze presets, priority 0–3, o, i, c,
   f, u, h), optimistic updates, attach-a-server in Settings with the token in
   the Keychain, a generic card plus per-kind renderers. Minimalism lands here:
   one list, journal as a quiet second surface, briefing and threads out of
   the default view.
3. **Rich kinds and actions.** Email read and reply, calendar view and modify
   (`event` kind), Linear create and complete. Each is a server action
   declaration plus a renderer.
4. **Threads as files.** The idea file plus its linked files (Markdown links,
   wiki links, and the `opal.links` connections from the properties work) as
   whole-context chat; chat as a drawer on the file; a visible context budget;
   retire the Threads nav. Independent of the feed track.

## 5. Slice 1 design: approved sections

### Section 1: Repository layout and runtime (approved)

```
opal/
  src/         the Electron client, unchanged
  protocol/    @opal/feed-protocol: the wire types, validators, and version
  server/      @opal/basecamp: the always-on server for the Mac mini
```

- npm workspaces at the root list `protocol` and `server`. Client and server
  import the protocol package by name, so one definition of every kind and
  action is shared and type-checked on both sides.
- The server is ESM on plain Node 22 with Fastify, `@linear/sdk`, and
  `googleapis`, ported with its layout kept: `adapters/`, `core/`, `store/`,
  `http/`. Config comes from `server/.env` as today: `LINEAR_API_KEY`,
  `VAULT_PATH`, `PORT` (4321), `DB_PATH`, and the three optional `GMAIL_*`
  values (OAuth client id, secret, refresh token; `scripts/gmail-auth.ts`
  mints the refresh token).
- No native modules in the server. It uses Node's built-in `node:sqlite`
  instead of better-sqlite3 and reads the existing `~/.basecamp/basecamp.db`
  unchanged. Reason: the root `postinstall` runs electron-rebuild, which would
  rebuild a hoisted better-sqlite3 for Electron's ABI and break the server on
  the development Mac.
- Tests run together: root Vitest gains a projects list covering the app's
  `src/tests` and the server's tests. The pre-commit hook keeps running all.
- The client never bundles the server. Forge packages the app as before
  (`asar: false`); `server/` and `protocol/` stay out of the bundle; the
  client consumes only the protocol types.
- Deploy is `server/deploy/setup-service.sh`, a port of the current launchd
  setup (`com.basecamp.agent`, `RunAtLoad`, `KeepAlive`, log in
  `~/.basecamp/basecamp.log`): clone the vault beside it, fill `.env`, run it.
- The old Basecamp web client is not ported. The old checkout keeps running
  until slice 2 reaches parity, then it is retired.

### Section 2: The feed protocol v1 (approved)

JSON over HTTP plus one server-sent-events stream, defined once in
`protocol/` with hand-written validators in the codebase's existing style.

- **Manifest**, `GET /v1/manifest`: protocol version, server name, refresh
  interval, and the item kinds it serves with the actions each supports. Opal
  reads it once on attach and refuses a major-version mismatch plainly.
- **Item**: `id` (unique per server, e.g. `linear:EXE-32`), `kind`, `title`,
  `summary` (plain text), `url`, `updatedAt`, `source` (name, label, accent),
  `facets` (small flat fields for filtering: team, from, unread, date),
  `payload` (typed per kind), `state` (status, snoozeUntil, priority tier and
  whether it was overridden).
- **Kinds in v1**: `issue`, `note`, `email`, which is what Basecamp emits.
  `event` is reserved for the calendar slice. Unknown kinds render as a plain
  card from title, summary, and url.
- **Universal verbs**, owned by the server's state store, valid on every item:
  `snooze` (preset or exact time), `done`, `activate`, `priority` (0–3 or
  clear). Semantics unchanged from Basecamp: done writes back to Linear
  (completed workflow state) and archives vault notes; presets are
  later-today (+3 h), tonight (18:00), tomorrow (09:00), this-weekend,
  next-week; feed order is effective priority tier, then newest date, then
  title; unprioritized items trail P0–P3.
- **Declared actions**: each kind lists actions with `id`, `label`, optional
  hotkey, and typed inputs (`text`, `longtext`, `datetime`, `enum` with
  options) so Opal can render a form for an action it has never seen. v1
  declares `edit-content` on notes and a server-level `create-issue` with the
  team enum. Reply, RSVP, and reschedule arrive in slice 3 as declarations.
- **Endpoints**: `GET /v1/manifest`, `GET /v1/feed` (`fresh=1` forces a
  refetch), `GET /v1/snoozed`, `POST /v1/items/:id/<verb>`,
  `POST /v1/items/:id/actions/:actionId`, `POST /v1/actions/:actionId`,
  `GET /v1/events`, `GET /v1/health`.
- **Events** (SSE): `feed-changed` after any refresh or mutation,
  `source-failed` with the source name when an adapter errors (last good items
  keep serving, orphaned state rows are pruned only after a cycle where every
  adapter succeeded), and a heartbeat. Opal applies mutations optimistically
  and reconciles on `feed-changed`.
- **Saved views move to the client.** Opal already has views and filters; the
  server stops serving them and leaves the `saved_views` table untouched.
- **Auth and transport**: a bearer token from `server/.env` (`BASECAMP_TOKEN`),
  stored by Opal in the Keychain. Tailscale is the network boundary; plain
  HTTP inside it for v1.
- **Errors**: `{ error: { code, message } }`. A failed source write-back
  returns 502 and leaves the item's state unchanged.

## 6. Slice 1 design: sections still to write and approve

Continue the brainstorming flow: present each section in chat, get approval,
then write the spec to `docs/superpowers/specs/2026-09-11-feed-protocol-and-basecamp-design.md`,
self-review it, get it reviewed, then invoke writing-plans.

- **Section 3: Server internals.** Adapter contract (keep Basecamp's
  `Adapter` interface: `source`, `fetchItems`, optional `complete`,
  `createItem`, `listTeams`, `writeContent`) and how each adapter maps to the
  protocol's kinds and facets. Item cache (per-adapter slots, last good items
  survive failures, 60 s refresh). State store on `node:sqlite` with the
  existing `item_state` schema (`item_id`, `snooze_until`, `status`,
  `priority_override`, `updated_at`) and the idempotent column migration.
  Action dispatch from declared actions to adapter methods. SSE fan-out.
- **Section 4: Testing.** Port Basecamp's tests (adapters, core, server,
  store) to the workspace; protocol validators get unit tests in `protocol/`;
  route tests use Fastify `inject`; one contract test proves the client-side
  validators accept what the server emits. No Electron process needed for any
  of it.
- **Section 5: Operations.** `.env` handling and secrets, the launchd service,
  logs, health endpoint, how to roll the server forward on the Mac mini, and
  what happens to `~/code/basecamp` afterwards (archive the repo once Opal is
  at parity).

## 7. Facts worth knowing before writing code

- Basecamp keyboard model in its web client (`web/src/App.tsx`): j/k move,
  h expand, p priority menu then 0–3, e done, z snooze menu with preset keys
  and t for exact time, u activate, o open, i inspect, c compose, f filter,
  Escape closes, Cmd+Enter submits. Preserve this in slice 2.
- Basecamp filter fields: source, team, kind, priority, text search over
  title and context, and a date range with presets (1 h to 30 d). These become
  client-side filters over `facets` in slice 2.
- Basecamp's item shape today: `Item { id, source, kind, title, context, url,
  sourceState { priority?, team?, status?, from?, date?, unread? } }` joined
  with `ItemState`. The protocol's `facets` is `sourceState` renamed and
  flattened; `payload` carries kind-specific bodies (issue description, note
  contents, email thread).
- Opal conventions the client side must follow (slice 2): new IPC channels are
  registered in `preload.ts`, validated in main, and typed under
  `src/renderer/shared/types/*.d.ts`; secrets go through `CredentialManager`
  (Keychain; add a `CredentialAccount` for the Basecamp token); the renderer
  never touches the network directly, main does.
- Opal's `OPAL_TEST_USER_DATA_DIR` now also moves Electron's Chromium profile
  (fixed 2026-09-11). Before that, every tour and E2E run read and wrote the
  real profile's localStorage. The real profile still holds a synthetic
  "Untitled view" draft from 2026-09-07; it was left for Cody to delete.
- `.codex/` and `AGENTS.md` in the repo root are untracked local files (Codex
  hooks and a copy of `CLAUDE.md`); leave them alone.

## 8. How to resume on another machine

```bash
git clone git@github.com:codyswain/opal.git && cd opal && git checkout dev
npm install
npm test            # expect 1,079 passing
npx tsc --noEmit    # expect no output
```

Then open this document, continue with Section 3 above, and keep the
one-section-at-a-time review before writing the spec. When slice 1 is
implemented, the server is started with `npm --workspace server start` and
verified with `curl localhost:4321/v1/health`.

### Resumed on a second machine, 2026-09-11 (Codys-Mac-mini)

- Clone at `~/code/opal` on `dev` at `727f294`. Baseline reproduced exactly:
  1,079 of 1,079 tests in 114 files, `npx tsc --noEmit` silent, the same 7
  lint warnings, 8 Playwright tests in 7.8 s, `npm start` opens the app.
- **Node must be 22.** `.nvmrc` said `v20.17.0`; it now says `v22.23.2`.
  On Node 20 three `pdfText` tests fail (`pdfjs-dist` needs
  `Promise.withResolvers`, added in Node 22). On Node 25, 214 tests fail
  because Node exposes a global `localStorage` stub that shadows happy-dom's
  (`localStorage.clear is not a function`). This machine has no nvm; Node 22
  is the Homebrew keg `node@22`, unlinked, so every command here runs with
  `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` first.
- Not present on this machine: `~/code/basecamp` (slice 1 still cannot port
  the server until it is pushed or copied), `~/.basecamp`,
  `/Applications/Opal.app`, `~/Opal Backups/`, and
  `~/Library/Application Support/Opal` (first launch creates it). The vault is
  at `~/code/vault`, last auto-sync 2026-09-09 14:49; it has no `Photos/`
  directory, so Today's photo strip is empty here. Tailscale is installed
  but stopped.
