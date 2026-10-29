import { useEffect, useState } from 'react';
import { parentFsPath } from '@/common/fsPaths';
import type { MarkdownProperties } from '@/types/markdown';
import type { MarkdownSaveState } from './useMarkdownDocument';

/**
 * The page's properties and file facts while the block is open. They are
 * read again after each save and after a change in the page's folder, since
 * both move Modified and Size.
 */
export function usePageProperties(path: string, open: boolean, saveState: MarkdownSaveState): MarkdownProperties | null {
  const [facts, setFacts] = useState<MarkdownProperties | null>(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (saveState === 'saved') setReads((count) => count + 1);
  }, [saveState]);

  useEffect(() => {
    if (!open) return;
    const folder = parentFsPath(path);
    return window.diskAPI.onChanged(({ directories }) => {
      if (folder && directories.includes(folder)) setReads((count) => count + 1);
    });
  }, [open, path]);

  useEffect(() => {
    if (!open) {
      setFacts(null);
      return;
    }
    let live = true;
    window.markdownAPI.properties(path)
      .then((response) => { if (live) setFacts(response.success ? response.data : null); })
      .catch(() => { if (live) setFacts(null); });
    return () => { live = false; };
  }, [open, path, reads]);

  return open ? facts : null;
}
