import { ROOT_VARIANTS, rootVariantAttribute } from '@/common/variants';
import { writePref } from '@/renderer/shared/prefs/prefs';
import type { VariantSides } from '@/types/dailyTest';
import { useVariantsStore } from './variantsStore';

/**
 * The root variants on B, kept in localStorage so the pre-paint script in
 * index.html can put their attributes on the root before the first frame.
 * The main process keeps the real sides; this is only their mirror.
 */
export const ROOT_VARIANTS_PREF = 'variants';

/** Puts each root variant's attribute on the root while it is on B, and mirrors the sides for the next launch. */
export function applyRootVariants(sides: VariantSides, root: HTMLElement = document.documentElement): void {
  const onB: Record<string, 'b'> = {};
  for (const name of ROOT_VARIANTS) {
    const attribute = rootVariantAttribute(name);
    if (sides[name] === 'b') {
      onB[name] = 'b';
      if (!root.hasAttribute(attribute)) root.setAttribute(attribute, '');
    } else if (root.hasAttribute(attribute)) {
      root.removeAttribute(attribute);
    }
  }
  writePref(ROOT_VARIANTS_PREF, onB);
}

/**
 * Follows the variants store from launch: loads the sides from the main
 * process, then applies them now and whenever a test switches one. Returns
 * the unsubscribe.
 */
export function startRootVariants(): () => void {
  const store = useVariantsStore;
  let last: VariantSides | null = null;
  const follow = (state: { sides: VariantSides; ready: boolean }) => {
    // Until the main process answers, the attributes the pre-paint script set stay.
    if (!state.ready || state.sides === last) return;
    last = state.sides;
    applyRootVariants(state.sides);
  };
  const unsubscribe = store.subscribe(follow);
  follow(store.getState());
  void store.getState().load();
  return unsubscribe;
}
