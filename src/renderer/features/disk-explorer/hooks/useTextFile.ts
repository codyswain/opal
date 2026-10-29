import { useEffect, useState } from 'react';

interface TextFileState {
  text: string | null;
  truncated: boolean;
  error: string | null;
  isLoading: boolean;
}

const INITIAL: TextFileState = { text: null, truncated: false, error: null, isLoading: false };

/**
 * Loads a file's text for the viewer.
 *
 * Guards against a stale response overwriting a newer one: switching files
 * quickly fires several reads, and without the cancellation flag the slowest
 * response wins and the page shows the wrong file's contents.
 */
export function useTextFile(filePath: string | null): TextFileState {
  const [state, setState] = useState<TextFileState>(INITIAL);

  useEffect(() => {
    if (!filePath) {
      setState(INITIAL);
      return;
    }

    let cancelled = false;
    setState({ ...INITIAL, isLoading: true });

    void window.diskAPI.readTextFile(filePath).then((response) => {
      if (cancelled) return;
      if (!response.success) {
        setState({ text: null, truncated: false, error: response.error, isLoading: false });
        return;
      }
      setState({
        text: response.data.text,
        truncated: response.data.truncated,
        error: null,
        isLoading: false,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  return state;
}
