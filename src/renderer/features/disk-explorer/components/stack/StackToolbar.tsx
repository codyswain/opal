import React, { useSyncExternalStore } from 'react';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isDocFile } from '@/common/fileKind';
import { DocToolbar } from '../editor/DocToolbar';
import { formatState, sameFormat, type FormatState } from '../editor/formatState';

interface Bound {
  view: EditorView | null;
  format: FormatState | null;
}

const NONE: Bound = { view: null, format: null };

/**
 * Which document a stack's toolbar acts on: the document section that last
 * had focus. Focus in a note leaves it with none. It is a small store of its
 * own, so a key typed in the bound section redraws the toolbar and not the
 * stack.
 */
export class ToolbarBinding {
  /** The bound section, kept while its editor is away, so it binds again when the editor comes back. */
  private path: string | null = null;
  private bound: Bound = NONE;
  private listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly snapshot = () => this.bound;

  /** Focus moved into the section at `path`; `view` is its editor, when it has one yet. */
  focus(path: string, view: EditorView | undefined): void {
    this.path = isDocFile(path) ? path : null;
    this.publish(this.path && view ? { view, format: formatState(view.state) } : NONE);
  }

  /** A section's editor came, or went with null. */
  view(path: string, view: EditorView | null): void {
    if (path !== this.path) return;
    this.publish(view ? { view, format: formatState(view.state) } : NONE);
  }

  /** A section's editor changed; the toolbar follows only the bound one. */
  update(path: string, view: EditorView, state: EditorState): void {
    if (path !== this.path || this.bound.view !== view) return;
    this.publish({ view, format: formatState(state) });
  }

  private publish(next: Bound): void {
    const { view, format } = this.bound;
    if (next.view === view && (next.format === format || (next.format && sameFormat(format, next.format)))) return;
    this.bound = next;
    for (const listener of this.listeners) listener();
  }
}

/** The one toolbar of a stack that holds documents, above its scroll. */
export function StackToolbar({ binding }: { binding: ToolbarBinding }) {
  const { view, format } = useSyncExternalStore(binding.subscribe, binding.snapshot);
  return <DocToolbar view={view} format={format} />;
}
