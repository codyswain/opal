# Today over the vault

The September 8 product discussion supersedes the Finder-first framing of the August architecture spec. Opal opens onto a day; real vault files remain authoritative. This first slice reads the user's existing layout without migration or connector calls.

Today becomes the default route and first navigation item. A date picker and previous/next controls select a local calendar day. A vault selector uses opened roots containing `Inbox/Logs`; selecting another folder never silently creates a new vault. Selection persists as a UI preference.

The main column contains a short briefing extracted from `Inbox/Digests/<date>.md`, an editable journal, and the day's activity log. The journal is the portion before `## Activity Log` in `Inbox/Logs/<date>.md`. Activity remains read-only. Saving rereads the file, compares the journal with the original, and preserves fresh activity appended by routines. Concurrent journal changes cause a visible conflict; no force overwrite. A missing day can be explicitly created using `Archive/Journal/Template.md`, falling back to morning/evening prompts if the template is absent. A new day is never created merely by browsing.

Journal writing uses a plain Markdown surface in this slice to preserve arbitrary existing text. Autosave is debounced and pending drafts remain in session state when navigating or hiding. Failed writes retain the draft and offer retry. Cmd/Ctrl+Shift+J hides the journal and photos on Today; the preference persists. This is screen privacy in Today, not encryption or a guarantee that opening the source elsewhere hides it.

The side column shows unchecked items from `RAM/todo.md` and active/pending candidates from `RAM/triage/state.json`. Markdown checkboxes can be completed against the latest file revision. Triage candidates remain read-only with context and source references. This is the current queue, explicitly labeled as such on historical days; it does not pretend to reconstruct historical task state. Every source can be opened in Files. No connector writeback or inferred task acceptance.

Photos come from local image links in the day's journal and an optional `Photos/<date>/` folder. Only resolved in-vault paths are used. No recursive full-library scan, EXIF inference, or Apple Photos integration in this slice. An empty state explains how to associate photos with a day.

Use existing disk/Markdown APIs, allowed roots, atomic revision-checked writes, theme tokens, shell navigation, and file-change notifications. Do not index or transmit vault contents during implementation. Routine execution, cross-day contextual chat, thread management, capture-date photo indexing, and Git controls are subsequent slices. Existing file and chat views remain reachable.

Validation: unit tests for section boundaries, preservation of concurrent activity, rejection of concurrent journal edits, task parsing/update, date handling, and safe photo paths. Component tests for privacy and missing/error states. Run the existing unit/contract suite, lint, type check, production builds, then inspect Today in the running app without editing personal files.
