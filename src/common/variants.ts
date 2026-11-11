import type { VariantSide, VariantSides } from '@/types/dailyTest';

/**
 * The variants this build knows: each name has a version B in the app beside
 * version A. A test's variant is added here, one line, and the component
 * branches on `useVariant(name)`. A test naming a variant missing here needs
 * a newer build.
 */
export const VARIANTS = [] as const;

export type VariantName = (typeof VARIANTS)[number];

/** A variant name as a test file or the state file writes it. */
export const isVariantName = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export const isVariantSide = (value: unknown): value is VariantSide => value === 'a' || value === 'b';

/** The sides a state file lists, keeping only well-formed entries on B; anything else reads as all on A. */
export function parseVariantSides(json: unknown): VariantSides {
  if (!json || typeof json !== 'object' || (json as { version?: unknown }).version !== 1) return {};
  const sides = (json as { sides?: unknown }).sides;
  if (!sides || typeof sides !== 'object' || Array.isArray(sides)) return {};
  const result: VariantSides = {};
  for (const [name, side] of Object.entries(sides)) {
    if (isVariantName(name) && side === 'b') result[name] = 'b';
  }
  return result;
}
