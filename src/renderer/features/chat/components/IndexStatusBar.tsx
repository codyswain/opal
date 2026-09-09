import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Database, RefreshCw, Square } from 'lucide-react';
import { formatRelativeTime } from '@/common/relativeTime';
import { basenameFsPath } from '@/common/fsPaths';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/renderer/shared/ui';
import type { IndexProgress, LibraryIndexStatus } from '@/types/chat';
import './writingControls.css';

interface IndexStatusBarProps {
  status: LibraryIndexStatus | null;
  error: string | null;
  onUpdate: () => void;
  onCancel: () => void;
}

const needsKey = (message: string | null) => !!message && /API key/i.test(message);
const count = (value: number, singular: string, plural = `${singular}s`) => `${value.toLocaleString()} ${value === 1 ? singular : plural}`;

export function describeProgress(progress: IndexProgress): string {
  const file = progress.currentFile ? ` · ${basenameFsPath(progress.currentFile)}` : '';
  switch (progress.phase) {
    case 'scanning':
      return `Scanning your library… ${count(progress.done, 'file')} found`;
    case 'reading':
      return `Reading files ${Math.min(progress.done + 1, progress.total).toLocaleString()} of ${progress.total.toLocaleString()}${file}`;
    case 'embedding':
      return progress.total === 0
        ? 'Nothing new to embed'
        : `Embedding passages ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}${file}`;
  }
}

const Skipped: React.FC<{ skipped: LibraryIndexStatus['skipped'] }> = ({ skipped }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-foreground">
        {count(skipped.length, 'file')} skipped
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="max-h-72 w-96 overflow-auto p-3 text-xs">
      <p className="mb-2 font-medium text-foreground">Not indexed</p>
      <ul className="flex flex-col gap-1.5">
        {skipped.slice(0, 50).map((item) => (
          <li key={item.path} className="flex flex-col" title={item.path}>
            <span className="truncate text-foreground">{basenameFsPath(item.path)}</span>
            <span className="text-muted-foreground">{item.reason}</span>
          </li>
        ))}
        {skipped.length > 50 ? <li className="text-muted-foreground">and {skipped.length - 50} more</li> : null}
      </ul>
    </PopoverContent>
  </Popover>
);

/** Where the library index stands, and the one explicit control that spends API calls. */
export const IndexStatusBar: React.FC<IndexStatusBarProps> = ({ status, error, onUpdate, onCancel }) => {
  const problem = error ?? status?.error ?? null;
  const progress = status?.indexing ? status.progress : null;
  const fraction = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : null;
  return (
    <div data-testid="chat-index-status" className="library-context-bar">
      <div className="library-context-row">
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="library-context-trigger">
              <Database aria-hidden size={13} /><span>Library context</span><ChevronDown aria-hidden size={12} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="library-context-popover">
            <h2>Think with your library</h2>
            <p>Your notes can give this thread useful context. You choose when to connect or update them.</p>
            {status?.ready ? (
              <div className="library-context-detail">
                <p>{count(status.files, 'file')}, {count(status.chunks, 'passage')}{status.lastIndexedAt ? `, updated ${formatRelativeTime(status.lastIndexedAt, Date.now())}` : ''}</p>
                {status.cancelled && <p>Indexing stopped early. What finished is still available.</p>}
                {status.staleFiles > 0 && <p>{count(status.staleFiles, 'change')} since the last update.</p>}
                {status.skipped.length > 0 && <Skipped skipped={status.skipped} />}
              </div>
            ) : <p>Your library is not indexed yet.</p>}
            <p className="library-sharing-note">Indexing sends the text of your Markdown, text and PDF files to OpenAI for embeddings.</p>
            {needsKey(problem) && <Link to="/settings" className="text-focus underline underline-offset-2">Add your OpenAI API key in Settings</Link>}
            <div className="library-context-controls">
              {status?.indexing ? (
                <Button size="compact" variant="outline" onClick={onCancel}><Square aria-hidden size={12} />Stop</Button>
              ) : (
                <Button size="compact" variant={status?.ready ? 'outline' : 'default'} onClick={onUpdate}>
                  <RefreshCw aria-hidden size={13} />{status?.ready ? 'Update index' : 'Index library'}
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <span role="status" className="library-context-summary">
          {status?.indexing ? (progress ? describeProgress(progress) : 'Indexing your library…') : status?.ready ? `${count(status.files, 'file')}${status.cancelled ? ' · stopped early' : status.staleFiles > 0 ? ' · update available' : ''}` : 'Not connected'}
        </span>
      </div>
      {problem && <span role="alert" className="library-context-error">{problem}</span>}
      {status?.indexing && (
        <div role="progressbar" aria-label="Indexing progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)} className="library-context-progress">
          <div className={fraction === null ? 'animate-pulse' : undefined} style={{ width: fraction === null ? '33%' : `${fraction * 100}%` }} />
        </div>
      )}
    </div>
  );
};
