# Threads

Threads replaces the Chat navigation label while retaining existing conversations
and the `/chat` route. Nothing is moved or deleted during upgrade.

- Name threads, search by name or starting context, and resume recent threads
  from Today. The last selected thread is remembered on this Mac.
- A task handoff attaches its original title, date, context, and source link.
  The initial message remains editable and is never sent automatically.
- Unsent drafts and queued handoffs are atomically saved in
  `Application Support/Opal/library/chat/drafts.json`. The composer distinguishes
  saving, saved, and failed writes. Outstanding writes block normal closing;
  failed writes retain the text and offer Retry saving.
- Scratch drafts appear as **Unfinished thought**. Opening a new thread does not
  discard an unfinished draft elsewhere.
- Archive keeps history and drafts. Restore makes the thread active again.
  Creating a thread no longer prunes history to the latest 30 conversations.
- Failed submissions keep the draft unless main confirms that the user's message
  is already stored in the conversation. Sending is pinned to the selected thread.

Conversation files remain local JSON in the existing library/chat directory, so
the workspace recovery tool includes them. This does not add cross-device sync
or automatically migrate chats into a mounted vault. Keychain credentials remain
outside the workspace. A crash before a pending save is acknowledged can still
lose the newest edit; the saved indicator is the durability boundary.

AI receives messages only on Send. Resuming a thread does not transmit content.
The current model context remains the most recent nine messages plus retrieved
sources; persistent history is not a claim of unlimited model memory.

Pinned threads stay above other threads in the list and in Today’s continuation
section. Pinning is stored with the conversation and survives app restarts;
archiving keeps the pin for when the thread is restored.

The thread list can be hidden, and its visibility is remembered on this Mac.
Small windows begin with the list hidden. The composer grows with the draft and
can expand into a writing room. Library indexing details and explicit controls
are available from Library context. Opening that control does not index files.

Calendar questions (today, yesterday, last/past N days up to 366, this/last week
or month, past week, explicit ISO dates/ranges, most recent) read current dated Markdown/text files from mounted roots. Rolling day ranges include today and use the Mac’s local calendar. Weeks start
on Monday; last week/month means the previous complete calendar period, while
past week means seven days through today. Explicit ranges show their endpoints. Filename dates are
evidence of the note date, not file modification timestamps. The model receives
coverage and missing-day information. Reads are bounded to 60 files and 3,000
characters per file, with omissions disclosed in its context. Other date phrasing
still uses semantic retrieval; this is not a general natural-language date parser.
Only cited files appear below an answer; passages from one file share a citation.

Quick search returns name matches first, then exact case-insensitive substrings
from locally indexed contents. “Search current text files” scans current Markdown
and text files without AI, including files absent from the index. It excludes
hidden files and symlinks and observes mounted roots. Deep search is bounded to
5,000 files, 25 MiB total, 1 MiB per file and 50 results; partial searches are
labeled. PDFs remain available through indexed contents, not the deep text scan.

New answers keep a deterministic retrieval record beside the generated text.
Expand “Daily notes checked” or “Library context checked” to inspect its scope,
index date, missing days and limits. This record is saved with the message.
Older messages without this metadata remain readable.

Stop aborts the network request and saves any partial answer with a Stopped
marker. The send lock stays in place until main acknowledges the stop. Cancelling
while local dated notes are being read is observed before the model request.
