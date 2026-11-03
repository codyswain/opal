import React, { useEffect, useState } from 'react';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import type { DiskEntry } from '@/types/disk';
import type { FileInfoStatus } from '@/types/files';
import { Button } from '@/renderer/shared/ui';
import { useTextFile } from '../hooks/useTextFile';

/** Pages a PDF should open at, by path, set by a link with `#page=` just before it opens. */
const pdfPages = new Map<string, number>();

/** Opens the next tab of `path` at `page`, as `![[q3.pdf#page=3]]` asks. */
export function openPdfAtPage(path: string, page: number): void {
  pdfPages.set(path, page);
}

/**
 * The page for a file that is not Markdown: images inline, PDFs in
 * Chromium's own viewer, video and audio in native players, text as plain
 * text, and anything else handed to the app macOS opens it with. A file whose
 * bytes are still on the Mini says so first, with Get from Mini.
 */
export const FileViewer: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const [status, setStatus] = useState<FileInfoStatus | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setStatus(null);
    if (!window.filesAPI?.info) return undefined;
    void Promise.resolve()
      .then(() => window.filesAPI.info(entry.path))
      .then((info) => { if (live) setStatus(info.success ? info.data.status : null); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [entry.path, version]);
  if (status === 'lfs-missing') return <NotDownloaded key={entry.path} entry={entry} onHere={() => setVersion((value) => value + 1)} />;
  return <Shown key={`${entry.path}:${version}`} entry={entry} />;
};

const Shown: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  switch (entry.kind) {
    case 'image':
      return (
        // Flex, not grid: a grid's auto row would let a tall image overflow max-h-full.
        <div className="flex h-full items-center justify-center p-8">
          <img
            key={entry.path}
            src={toOpalFileUrl(entry.path)}
            alt={entry.name}
            decoding="async"
            data-testid="image-viewer"
            className="max-h-full max-w-full object-contain"
          />
        </div>
      );
    case 'pdf':
      return <PdfViewer entry={entry} />;
    case 'video':
      return <MediaViewer entry={entry} kind="video" />;
    case 'audio':
      return <MediaViewer entry={entry} kind="audio" />;
    case 'text':
      return <TextViewer key={entry.path} entry={entry} />;
    default:
      return <OpenInDefaultApp entry={entry} message="Opal can't show this file." />;
  }
};

/** Chromium's viewer, without its thumbnail rail, at the page a link asked for. */
const PdfViewer: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const [page] = useState(() => {
    const asked = pdfPages.get(entry.path) ?? null;
    pdfPages.delete(entry.path);
    return asked;
  });
  return (
    <embed
      key={entry.path}
      src={`${toOpalFileUrl(entry.path)}#${page ? `page=${page}&` : ''}navpanes=0`}
      type="application/pdf"
      data-testid="pdf-viewer"
      className="h-full w-full"
    />
  );
};

/** A movie or a recording in the browser's own player; one Opal can't play offers its app instead. */
const MediaViewer: React.FC<{ entry: DiskEntry; kind: 'video' | 'audio' }> = ({ entry, kind }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return <OpenInDefaultApp entry={entry} message={kind === 'video' ? "Can't play this video in Opal." : "Can't play this audio in Opal."} />;
  const fail = (event: React.SyntheticEvent<HTMLMediaElement>) => {
    // Code 1 is a load that was stopped, which is no failure.
    if (event.currentTarget.error && event.currentTarget.error.code !== 1) setFailed(true);
  };
  if (kind === 'video') {
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-8">
        <video key={entry.path} src={toOpalFileUrl(entry.path)} controls preload="metadata" onError={fail} data-testid="video-viewer" className="max-h-full max-w-full rounded-row bg-[#000000]" />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <p className="text-ui font-medium text-foreground">{entry.name}</p>
      <audio key={entry.path} src={toOpalFileUrl(entry.path)} controls preload="metadata" onError={fail} data-testid="audio-viewer" className="w-full max-w-md" />
    </div>
  );
};

/** A file whose bytes are still on the Mini: Get from Mini fetches that one file, then it shows. */
const NotDownloaded: React.FC<{ entry: DiskEntry; onHere: () => void }> = ({ entry, onHere }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const get = async () => {
    setBusy(true);
    const result = await window.filesAPI.fetch(entry.path).catch(() => null);
    setBusy(false);
    if (result?.success && result.data === 'here') onHere();
    else setError(result && !result.success ? result.error : `Could not get ${entry.name} from the Mini.`);
  };
  return (
    <div data-testid="not-downloaded" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-ui text-foreground">{entry.name}</p>
      <p className="text-ui text-foreground-tertiary">Not downloaded yet</p>
      <Button variant="outline" size="compact" disabled={busy} onClick={() => void get()}>
        {busy ? 'Getting…' : 'Get from Mini'}
      </Button>
      {error ? <p role="alert" className="text-ui text-foreground">{error}</p> : null}
    </div>
  );
};

const TextViewer: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const { text, truncated, error, isLoading } = useTextFile(entry.path);
  if (error) return <OpenInDefaultApp entry={entry} message={error} />;
  if (isLoading || text === null) {
    return <p role="status" className="p-8 text-ui text-foreground-tertiary">Opening file…</p>;
  }
  return (
    <div className="h-full overflow-auto">
      <pre
        data-testid="text-viewer"
        className="mx-auto max-w-reading whitespace-pre-wrap break-words px-8 py-10 font-mono text-control text-foreground"
      >
        {text}
      </pre>
      {truncated ? (
        <p className="mx-auto max-w-reading px-8 pb-10 text-metadata text-foreground-tertiary">
          Showing the first part of this file only.
        </p>
      ) : null}
    </div>
  );
};

const OpenInDefaultApp: React.FC<{ entry: DiskEntry; message: string }> = ({ entry, message }) => {
  const [error, setError] = useState<string | null>(null);
  // What Open did instead of a plain open: a read-only copy of an LFS file, or Finder for a script.
  const [note, setNote] = useState<string | null>(null);
  const open = async () => {
    const result = await window.diskAPI.openExternal(entry.path);
    setError(result.success ? null : result.error);
    const done = result.success ? result.data : undefined;
    setNote(done?.action === 'opened' ? done.notice ?? null : done?.action === 'revealed' ? done.reason : null);
  };
  return (
    <div
      data-testid="open-in-default-app"
      className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <p className="text-ui text-foreground-tertiary">{message}</p>
      <Button variant="outline" size="compact" onClick={() => void open()}>
        Open in default app
      </Button>
      {error ? <p role="alert" className="text-ui text-foreground">{error}</p> : null}
      {note ? <p role="status" className="text-ui text-foreground-tertiary">{note}</p> : null}
    </div>
  );
};
