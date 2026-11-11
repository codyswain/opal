import { useCallback, useEffect, useState } from 'react';
import type { VaultTest } from '@/types/dailyTest';
import { useVaultRoot } from './useDay';

/**
 * The vault's current A/B test on `today`, or null when there is none, read
 * again when `Library/tests` changes on disk. `replace` takes the test as an
 * answer left it, before the new read arrives.
 */
export function useDailyTest(today: string): { test: VaultTest | null; replace: (test: VaultTest) => void } {
  const vault = useVaultRoot();
  const [test, setTest] = useState<VaultTest | null>(null);

  useEffect(() => {
    const root = vault.root;
    const api = window.vaultAPI;
    if (!root || !api?.test) {
      setTest(null);
      return;
    }
    let live = true;
    let request = 0;
    const read = () => {
      const asked = ++request;
      void api.test(root, today).then(
        (result) => {
          if (live && asked === request) setTest('data' in result ? result.data : null);
        },
        () => {
          if (live && asked === request) setTest(null);
        },
      );
    };
    read();
    const unsubscribe = api.onTestChanged?.((change) => {
      if (change.root === root) read();
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [today, vault.root]);

  const replace = useCallback((next: VaultTest) => setTest(next), []);
  return { test, replace };
}
