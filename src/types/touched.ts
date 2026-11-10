/** What a touched item is: a vault file, a folder a group stands for, a Google Doc, an issue or a pull request. */
export type TouchedKind = 'file' | 'folder' | 'doc' | 'issue' | 'pr';

/** One day of the week on which an item was touched. */
export interface TouchedHit {
  /** Agent-turn log lines that day that link the item. */
  lines: number;
  /** The sentence of the latest of those lines. */
  text: string;
}

/** Something the week's activity logs link to. */
export interface TouchedItem {
  /** `Library/plan.md` for a file or a group's folder, `linear:ABC-123`, `github:owner/repo#12`, `gdoc:<id>`. */
  key: string;
  kind: TouchedKind;
  /** "ABC-123" or "PR 12"; null for files and docs. */
  id: string | null;
  /** May be empty for an issue or pull request with no known title: the id says it. */
  name: string;
  /** The absolute vault file a click opens, for a file or folder. */
  path: string | null;
  /** The URL a click opens, for the other kinds. */
  url: string | null;
  /** Monday first. */
  days: (TouchedHit | null)[];
  /** Index into the eight colour palette for an item touched on two or more days, else null. */
  colour: number | null;
}

/** The items a week's logs touched, Monday to Sunday. */
export interface TouchedWeek {
  root: string;
  /** The week's Monday, YYYY-MM-DD. */
  monday: string;
  items: TouchedItem[];
}

/** Sent as `vault:touched-changed` when a week the renderer asked for reads differently on disk. */
export interface TouchedWeekChange {
  root: string;
  monday: string;
}
