/**
 * Versioned, namespaced preference storage.
 *
 * localStorage rather than IPC because these values must be readable before
 * React's first paint — pane sizes and theme decide what the first frame looks
 * like, and an async round-trip to main would reintroduce the flash this work
 * exists to remove.
 *
 * Every value is wrapped in an envelope carrying a schema version. A value
 * written by a different version is discarded in favour of the fallback, so
 * changing a stored shape can never crash a launch.
 */

export const PREFS_VERSION = 1;

const NAMESPACE = 'opal.';

interface Envelope<T> {
  version: number;
  value: T;
}

function isEnvelope(candidate: unknown): candidate is Envelope<unknown> {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'version' in candidate &&
    'value' in candidate &&
    typeof (candidate as Envelope<unknown>).version === 'number'
  );
}

export function readPref<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(NAMESPACE + key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;

  try {
    const parsed: unknown = JSON.parse(raw);
    // A bare value is either pre-envelope data or something another library
    // wrote. Either way its shape is unknown, so it is not trustworthy.
    if (!isEnvelope(parsed)) return fallback;
    if (parsed.version !== PREFS_VERSION) return fallback;
    return parsed.value as T;
  } catch {
    return fallback;
  }
}

export function writePref<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;

  const envelope: Envelope<T> = { version: PREFS_VERSION, value };
  try {
    window.localStorage.setItem(NAMESPACE + key, JSON.stringify(envelope));
  } catch {
    // Quota exceeded, or storage disabled. A lost preference is cosmetic.
  }
}
