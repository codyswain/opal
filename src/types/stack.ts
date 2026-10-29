/**
 * A stack shows several Markdown files one after another in one scroll, in
 * one tab. The head is the file the stack opens by: today's daily page, a
 * recording's summary or a chat's thread card.
 */
export type StackKind = 'daily' | 'recording' | 'chat';

export const STACK_KINDS: readonly StackKind[] = ['daily', 'recording', 'chat'];

/** One file in a stack. */
export interface StackSection {
  path: string;
  /** The section's title, drawn in the header. */
  label: string;
  /** Muted text after the label, or null. */
  detail: string | null;
  role: 'head' | 'part';
  /** Whether the section opens unfolded when Cody has not folded it himself. */
  defaultOpen: boolean;
  /** The same rule the editor uses for this path. */
  readOnly: boolean;
  /** For height estimates before the section is measured. */
  size: number;
  mtimeMs: number;
}

export interface VaultStack {
  kind: StackKind;
  head: string;
  /** The head first, then the other files in order. Each path at most once. */
  sections: StackSection[];
  /** Folders whose changes can change the list. */
  folders: string[];
}
