import React, { memo, useId } from 'react';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { ChevronRight, FileText } from 'lucide-react';
import type { StackSection } from '@/types/stack';
import { cn } from '@/renderer/shared/utils/cn';
import { MarkdownEditor } from '../editor/MarkdownEditor';
import type { MarkdownSaveState } from '../editor/useMarkdownDocument';

/** What a section asks of its stack. One object for the life of the stack, so sections stay memoized. */
export interface SectionActions {
  toggleFold: (path: string, event: React.MouseEvent) => void;
  openAlone: (path: string, event: React.MouseEvent) => void;
  /** Follows a wiki link from inside a section. */
  openNote: (path: string) => void;
  /** The rest return the same function or extension for a path every time. */
  extensions: (path: string) => Extension;
  onLoadedFor: (path: string) => () => void;
  onViewFor: (path: string) => (view: EditorView | null) => void;
  togglePropertiesFor: (path: string) => () => void;
  refFor: (path: string) => (element: HTMLElement | null) => void;
}

interface StackSectionViewProps {
  section: StackSection;
  /** The first section has no rule above it. */
  first: boolean;
  /** The label uses the page title's size; otherwise the smaller heading size. */
  large: boolean;
  /** The stack's only file, as a recording not split yet: it reads as a page, with nothing to fold or open alone. */
  lone: boolean;
  open: boolean;
  live: boolean;
  /** The body's height while it is a placeholder. */
  height: number;
  status: MarkdownSaveState | undefined;
  autoFocusEmpty: boolean;
  propertiesShown: boolean;
  position: number;
  setSize: number;
  actions: SectionActions;
}

const PROBLEM: Partial<Record<MarkdownSaveState, string>> = {
  conflict: 'Changed on disk',
  error: 'Not saved',
};

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * Marks the article while the pointer is on the section's start, its rule
 * and its first line, where a quiet header's tools sit. A quiet header has no
 * box of its own to hover, since it lies over the file's first heading.
 */
function markStart(event: React.PointerEvent<HTMLElement>) {
  const article = event.currentTarget;
  const row = article.querySelector<HTMLElement>(':scope > .opal-stack-header .opal-stack-title-row');
  article.toggleAttribute('data-start', !!row && event.clientY <= row.getBoundingClientRect().bottom);
}

function clearStart(event: React.PointerEvent<HTMLElement>) {
  event.currentTarget.removeAttribute('data-start');
}

/**
 * One file in a stack. Its header reads as a heading of the document; the
 * fold control, the file name and the open button show only while the
 * pointer or focus is on it. A part whose text starts with a heading is
 * quiet while open: that heading is its title and the header draws none,
 * so the stack does not say the same thing twice. The body is the file's own
 * editor, a blank placeholder of the height it last had, or nothing while
 * folded.
 */
export const StackSectionView = memo(function StackSectionView({
  section, first, large, lone, open, live, height, status, autoFocusEmpty, propertiesShown, position, setSize, actions,
}: StackSectionViewProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const problem = status ? PROBLEM[status] : undefined;
  const name = fileName(section.path);
  const shownName = name.replace(/\.md$/i, '');
  const quiet = open && !lone && section.textHeading !== null;
  const lead = quiet ? ({ '--stack-lead': section.textHeading?.line ?? 0 } as React.CSSProperties) : undefined;

  return (
    <article
      ref={actions.refFor(section.path)}
      data-stack-section={section.path}
      data-role={section.role}
      data-open={open ? '' : undefined}
      aria-labelledby={titleId}
      aria-posinset={position}
      aria-setsize={setSize}
      className="opal-stack-section"
      onPointerMove={quiet ? markStart : undefined}
      onPointerLeave={quiet ? clearStart : undefined}
    >
      <header className="opal-stack-header" data-quiet={quiet ? '' : undefined}>
        <div className="opal-stack-column">
          {first ? null : <div aria-hidden className="opal-stack-rule" />}
          <div
            className={cn('opal-stack-title-row', large ? 'opal-stack-title-large' : null)}
            data-level={quiet ? section.textHeading?.level : undefined}
            style={lead}
          >
            {lone ? null : (
              <button
                type="button"
                aria-label={open ? `Fold ${shownName}` : `Unfold ${shownName}`}
                aria-expanded={open}
                title="Option-click folds or unfolds every section"
                onClick={(event) => actions.toggleFold(section.path, event)}
                className="opal-stack-chevron"
              >
                <ChevronRight aria-hidden className="h-4 w-4" />
              </button>
            )}
            {quiet ? (
              <h2 id={titleId} className="sr-only">{section.label}</h2>
            ) : (
              <h2 id={titleId} className="opal-stack-title">
                {lone ? (
                  <span className="opal-stack-label">{section.label}</span>
                ) : (
                  <button
                    type="button"
                    className="opal-stack-label"
                    aria-expanded={open}
                    onClick={(event) => actions.toggleFold(section.path, event)}
                  >
                    {section.label}
                  </button>
                )}
                {section.detail ? <span className="opal-stack-detail">{section.detail}</span> : null}
              </h2>
            )}
            <div className="opal-stack-tools">
              {problem ? <span role="status" className="opal-stack-problem">{problem}</span> : null}
              {section.label !== shownName ? <span className="opal-stack-name">{shownName}</span> : null}
              {lone ? null : (
                <button
                  type="button"
                  aria-label={`Open ${shownName} on its own`}
                  title={`Open ${shownName} on its own`}
                  onClick={(event) => actions.openAlone(section.path, event)}
                  onAuxClick={(event) => {
                    if (event.button === 1) actions.openAlone(section.path, event);
                  }}
                  className="opal-stack-open"
                >
                  <FileText aria-hidden className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>
      {open ? (
        <div className="opal-stack-body" data-live={live ? '' : undefined}>
          {live ? (
            <MarkdownEditor
              path={section.path}
              layout="section"
              autoFocusEmpty={autoFocusEmpty}
              openNote={actions.openNote}
              propertiesShown={propertiesShown}
              onToggleProperties={actions.togglePropertiesFor(section.path)}
              onView={actions.onViewFor(section.path)}
              onLoaded={actions.onLoadedFor(section.path)}
              extensions={actions.extensions(section.path)}
              loadingHeight={height}
            />
          ) : (
            <div aria-busy="true" aria-label={`${shownName}, not drawn yet`} className="opal-stack-placeholder" style={{ height }} />
          )}
        </div>
      ) : null}
    </article>
  );
});
