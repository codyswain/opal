import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultDay, VaultInfo, VaultResult } from "@/types/vault";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";

export function useVaultDay(selectedRoot: string, date: string) {
  const roots = useDiskStore((state) => state.roots);
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<VaultDay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationPending = useRef(false);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const root =
    vaults.find((vault) => vault.path === selectedRoot)?.path ??
    vaults[0]?.path ??
    "";
  const scope = `${root}:${date}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const data = loaded?.root === root && loaded.date === date ? loaded : null;
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    void useDiskStore.getState().loadRoots();
  }, []);
  useEffect(() => {
    let alive = true;
    setDiscovering(true);
    void window.vaultAPI
      .discover()
      .then((result) => {
        if (!alive) return;
        if (result.success === true) {
          setVaults(result.data);
          setDiscoveryError(null);
        } else setDiscoveryError(result.error);
      })
      .catch(() => {
        if (alive)
          setDiscoveryError("Could not find your vault. Try refreshing.");
      })
      .finally(() => {
        if (alive) setDiscovering(false);
      });
    return () => {
      alive = false;
    };
  }, [roots, revision]);
  useEffect(() => {
    const id = ++request.current;
    if (!root) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void window.vaultAPI
      .readDay(root, date)
      .then((result) => {
        if (id !== request.current) return;
        if (result.success === true) setLoaded(result.data);
        else setError(result.error);
      })
      .catch(() => {
        if (id === request.current)
          setError(
            "Could not refresh this day. Your last loaded view is still available.",
          );
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    return () => {
      request.current++;
    };
  }, [root, date, revision]);
  useEffect(() => {
    if (!root) return;
    let timer: ReturnType<typeof setTimeout>;
    const relevant = new Set([
      root,
      `${root}/Inbox/Logs`,
      `${root}/Inbox/Digests`,
      `${root}/RAM`,
      `${root}/RAM/triage`,
      `${root}/.opal/days`,
      `${root}/Photos/${date}`,
    ]);
    const off = window.diskAPI.onChanged(({ directories }) => {
      if (!directories.some((directory) => relevant.has(directory))) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [root, date, refresh]);
  // A Git checkout can change hidden metadata without a directory watcher event.
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const mutate = async (operation: () => Promise<VaultResult<unknown>>) => {
    // React state updates on the next render; this guard also covers same-turn submissions.
    if (mutationPending.current) return false;
    mutationPending.current = true;
    const origin = scope;
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      if (result.success === false) throw new Error(result.error);
      if (currentScope.current === origin) refresh();
      return true;
    } catch (reason) {
      if (currentScope.current === origin)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not save the change.",
        );
      return false;
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  };
  return {
    vaults,
    root,
    data,
    discovering,
    loading,
    busy,
    error: discoveryError ?? error,
    refresh,
    mutate,
  };
}
