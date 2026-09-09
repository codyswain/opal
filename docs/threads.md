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
