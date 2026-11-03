import { StateEffect } from '@codemirror/state';

/*
 * The effect that shows a link's popover, in a file of its own so that
 * wikiLinks.ts and fileActions.ts can use it without importing docMode.ts,
 * which imports them through formatCommands.ts.
 */

/** The link a click or Cmd+K is about, while its popover shows; `editing` once its fields are open. */
export interface LinkEditor {
  from: number;
  to: number;
  editing: boolean;
}

export const setLinkEditor = StateEffect.define<LinkEditor | null>();
