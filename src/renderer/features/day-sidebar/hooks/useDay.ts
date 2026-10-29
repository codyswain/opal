import { useEffect, useState } from 'react';
import { localDate } from '@/common/vaultModel';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import type { VaultDay } from '@/types/day';

export type DayState =
  | { status: 'loading' }
  | { status: 'no-vault' }
  | { status: 'error'; error: string }
  | { status: 'ready'; root: string; day: VaultDay };

/** The first opened folder that is a vault, as Today picks it. Asked again when the opened folders change. */
function useVaultRoot(): { root: string | null; checked: boolean; error: string | null } {
  const roots = useDiskStore((state) => state.roots.join('\n'));
  const [found, setFound] = useState<{ root: string | null; checked: boolean; error: string | null }>({
    root: null,
    checked: false,
    error: null,
  });

  useEffect(() => {
    let live = true;
    const api = window.vaultAPI;
    if (!api?.discover) {
      setFound({ root: null, checked: true, error: null });
      return;
    }
    void api.discover().then(
      (result) => {
        if (!live) return;
        if ('error' in result) setFound({ root: null, checked: true, error: result.error });
        else setFound({ root: result.data[0]?.path ?? null, checked: true, error: null });
      },
      (error: unknown) => {
        if (live) setFound({ root: null, checked: true, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [roots]);

  return found;
}

/**
 * Everything the vault holds for `date`, read again when the main process
 * says that day changed on disk. A live update keeps the day on screen until
 * the new read arrives; a different date starts from loading, so one day's
 * rows never show under another day's name.
 */
export function useDay(date: string): DayState {
  const vault = useVaultRoot();
  const [state, setState] = useState<DayState>({ status: 'loading' });

  useEffect(() => {
    if (!vault.checked) return;
    if (vault.error) {
      setState({ status: 'error', error: vault.error });
      return;
    }
    const root = vault.root;
    if (!root) {
      setState({ status: 'no-vault' });
      return;
    }
    let live = true;
    let request = 0;
    const read = () => {
      const asked = ++request;
      void window.vaultAPI.day(root, date).then(
        (result) => {
          if (!live || asked !== request) return;
          setState('error' in result ? { status: 'error', error: result.error } : { status: 'ready', root, day: result.data });
        },
        (error: unknown) => {
          if (live && asked === request) setState({ status: 'error', error: error instanceof Error ? error.message : String(error) });
        },
      );
    };
    setState((current) =>
      current.status === 'ready' && current.root === root && current.day.date === date ? current : { status: 'loading' },
    );
    read();
    const unsubscribe = window.vaultAPI.onDayChanged?.((change) => {
      if (change.root === root && change.date === date) read();
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [date, vault.checked, vault.error, vault.root]);

  return state;
}

/** Today's date, moving on at midnight. */
export function useToday(): string {
  const [today, setToday] = useState(localDate);
  useEffect(() => {
    const tick = () => setToday(localDate());
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, []);
  return today;
}
