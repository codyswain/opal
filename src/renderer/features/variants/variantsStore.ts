import { useEffect } from 'react';
import { create } from 'zustand';
import { VARIANTS, type VariantName } from '@/common/variants';
import type { VariantSide, VariantSides } from '@/types/dailyTest';

interface VariantsState {
  /** The variants this build knows. Tests set their own. */
  known: readonly string[];
  /** The side each variant is on, as the main process keeps it; a variant not listed is on A. */
  sides: VariantSides;
  loaded: boolean;
  load: () => Promise<void>;
  /** Puts a variant on a side. Resolves to an error message, or null. */
  set: (name: string, side: VariantSide) => Promise<string | null>;
  /** Takes the sides an answer left, so the app follows at once. */
  take: (sides: VariantSides) => void;
}

export const useVariantsStore = create<VariantsState>((set, get) => ({
  known: VARIANTS,
  sides: {},
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    set({ loaded: true });
    const result = await window.vaultAPI?.variants?.().catch(() => null);
    if (result && 'data' in result) set({ sides: result.data });
  },
  set: async (name, side) => {
    try {
      const result = await window.vaultAPI.setVariant(name, side);
      if ('error' in result) return result.error;
      set({ sides: result.data });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not switch the version.';
    }
  },
  take: (sides) => set({ sides }),
}));

/** Whether this build has both versions of a variant. */
export const knowsVariant = (state: Pick<VariantsState, 'known'>, name: string | null): name is string =>
  name !== null && state.known.includes(name);

/**
 * Which version of a component to show: 'a' unless the user switched this
 * variant to B in a test. `name` is from the registry in `src/common/variants.ts`.
 */
export function useVariant(name: VariantName): VariantSide {
  const load = useVariantsStore((state) => state.load);
  const side = useVariantsStore((state) => (state.known.includes(name) ? state.sides[name] ?? 'a' : 'a'));
  useEffect(() => {
    void load();
  }, [load]);
  return side;
}
