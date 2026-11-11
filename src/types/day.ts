/** A link in a day's files. Wiki links are vault files; markdown links to a URL are external. */
export interface DayLink {
  label: string;
  /** The wiki link target or the URL, as written. */
  target: string;
  external: boolean;
  /** The vault file the link resolves to, or null for an external link or a target that resolves to nothing. */
  path: string | null;
}

/** One line of the day's activity log. */
export interface DayLogEntry {
  /** HH:MM, when the line was written. */
  time: string;
  /** HH:MM at the end of a folded entry's range, or null. */
  until: string | null;
  /** The sentence, with any inline link shown as its label. */
  text: string;
  /** "agent turn", "routine run", "connector call" or "N connector calls". Null on lines from before the move. */
  kind: string | null;
  links: DayLink[];
}

/** A chat thread created or continued on the day. */
export interface DayChat {
  /** The thread card, or the session file when the thread has no card. */
  path: string;
  title: string;
  /** The card's status, such as "active", "pinned" or "archived". */
  status: string | null;
  /** "claude" or "codex", from the session with the latest activity that day. */
  tool: string | null;
  /** The thread was created that day. */
  isNew: boolean;
  /** "YYYY-MM-DD HH:MM" from the card. */
  created: string | null;
  /** HH:MM of the thread's last activity that day. */
  last: string;
  /** Messages Cody sent in the thread that day. */
  prompts: number;
}

/** A vault file the day touched: a note or deck in Documents, a person note in People. */
export interface DayFile {
  path: string;
  /** The label of its latest mention: a log line's link, or a speaker's name. */
  label: string;
  /** HH:MM of its latest mention: the log line, or the recording's start. */
  last: string;
}

/** A Meet or Pocket recording note from the day. */
export interface DayRecording {
  path: string;
  title: string;
  /** HH:MM from the HHMM in the file name. */
  time: string;
  /** The note's `source`, "meet" or "pocket". */
  source: string | null;
  durationMin: number | null;
  speakers: string[];
  attendees: string[];
  /** The Summary section has text beyond a placeholder. */
  hasSummary: boolean;
  /** External links above the first section, such as the Meet doc and the calendar event. */
  links: DayLink[];
}

export type DigestLevel = 'high' | 'medium' | 'low';

export interface DayDigestItem {
  /** Plain text, with no priority emoji or priority word. For a checkbox item, its one-line title. */
  text: string;
  /** The lines indented under a checkbox item, as plain text, or null when it has none. */
  detail: string | null;
  replyDrafted: boolean;
  /** Whether a checkbox item is ticked; null for an item with no checkbox, as in older digests. */
  checked: boolean | null;
  /**
   * Where a checkbox item is: its 0-based line in the body after the
   * frontmatter, and that line exactly as read. A tick names both, so the
   * main process can refuse a line that changed. Null with no checkbox.
   */
  at: { line: number; raw: string } | null;
}

export interface DayDigestGroup {
  /** "top" is the digest's Top 3. */
  level: 'top' | DigestLevel;
  items: DayDigestItem[];
}

export interface DayDigest {
  path: string;
  /** The digest's first heading. */
  title: string;
  /** Groups that have items, in this order: top, high, medium, low. The first is the top group. */
  groups: DayDigestGroup[];
  /** Section titles in order, from `##` headings or folded callout titles. */
  sections: string[];
}

/**
 * Everything the vault holds for one date. Lists are newest first. Paths are
 * absolute and inside the vault.
 */
export interface VaultDay {
  date: string;
  /** The date's daily page, the one Daily opens for today, when it exists. */
  daily: string | null;
  /** The day's activity log file, when it exists. */
  log: string | null;
  entries: DayLogEntry[];
  /**
   * The files the day's log links to, other than chats, recordings, people
   * and the day's own files, and not code or data files.
   */
  documents: DayFile[];
  chats: DayChat[];
  recordings: DayRecording[];
  /** Person notes the log links to, and the day's meeting speakers who have one. */
  people: DayFile[];
  digest: DayDigest | null;
}

/** Sent as `vault:day-changed` when a day the renderer asked for reads differently on disk. */
export interface VaultDayChange {
  root: string;
  date: string;
}
