import { useCallback, useState } from 'react';
import { readPref, writePref } from './prefs';

/**
 * Like useState, but the initial value comes from storage and every write is
 * persisted.
 *
 * The initializer is passed as a function so the read happens once during the
 * first render rather than on every render. Unlike the older useLocalStorage,
 * there is no re-read effect on mount: that effect caused a second render with
 * a different value on every single mount, which is exactly the flash this
 * module removes.
 */
export function usePref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback));

  const set = useCallback(
    (next: T) => {
      setValue(next);
      writePref(key, next);
    },
    [key]
  );

  return [value, set];
}
