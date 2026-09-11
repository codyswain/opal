# Today

Today is Opal's homepage over an existing vault. Open a folder containing `Inbox/Logs` to use it. The vault stays readable by other editors and routines.

- Browse days with the arrows or date picker; **Today** returns to the current date.
- **Show journal & photos** reveals personal content. **Cmd/Ctrl+Shift+J** toggles it while on Today. The preference survives restart. This hides content on Today only; source files opened in Files remain readable.
- Journal changes save automatically to `Inbox/Logs/YYYY-MM-DD.md`. The editor preserves the routine-owned `## Activity Log` section, including new entries written while you type. Concurrent journal changes produce a conflict. Retry after transient errors, or compare/copy your draft before explicitly choosing **Use saved version**.
- Unsaved drafts survive navigation within the session, and prevent normal window closing until resolved. They are not a backup against a forced quit or crash.
- A missing day's journal is created only with **Start this day's journal**. Opal uses `Archive/Journal/Template.md` when available.
- The briefing comes from the `## The brief` section of `Inbox/Digests/YYYY-MM-DD.md`, up to the next heading or quote. A digest without that section is reported as such. **Full briefing** opens its source.
- **On your list** reads unchecked tasks from `RAM/todo.md`; checking one updates that file. Triage items from `RAM/triage/state.json` are read-only, with suggestions kept separate. This is always the current queue, including when browsing a historical day.
- Photos come from local image links in the journal or `Photos/YYYY-MM-DD/`. Markdown image links resolve relative to the daily file; wiki image links resolve relative to the vault. Only images inside the selected vault appear. Photo capture-date indexing is not included yet.

Today makes no AI or connector calls. Existing routines can keep writing their files while Opal watches for changes. Routine scheduling, persistent contextual conversations, and a dedicated Threads view are subsequent work.
