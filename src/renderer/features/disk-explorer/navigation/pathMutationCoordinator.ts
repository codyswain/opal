import {
  isAbsoluteFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
  remapFsPath,
} from '@/common/fsPaths';
import { filesLocationSnapshots } from './filesLocationSnapshots';

export type AppPathMutationKind = 'rename' | 'move';

export interface AppPathMutation {
  kind: AppPathMutationKind;
  oldPath: string;
  newPath: string;
}

export type PathRemovalReason = 'external' | 'root-removed';
export interface PreparedPathMutation {
  commit(): void;
  rollback(): void;
}

export interface PathMutationParticipant {
  id: string;
  /**
   * Preparation must not mutate state. The coordinator prepares every
   * participant before synchronously committing any of them.
   */
  prepareAppMutation?: (
    mutation: AppPathMutation
  ) => PreparedPathMutation | void;
  preparePathRemoval?: (
    paths: readonly string[],
    reason: PathRemovalReason
  ) => PreparedPathMutation | void;
  prepareAllowedRoots?: (
    roots: readonly string[]
  ) => PreparedPathMutation | void;
}

export interface PathMutationCoordinator {
  register(participant: PathMutationParticipant): () => void;
  applyAppMutation(mutation: AppPathMutation): boolean;
  applyExternalRemoval(paths: readonly string[]): boolean;
  applyRootRemoval(rootPath: string): boolean;
  reconcileAllowedRoots(roots: readonly string[]): boolean;
  getAllowedRoots(): readonly string[] | null;
}

function normalizedMutation(
  mutation: AppPathMutation
): AppPathMutation | null {
  const oldPath = normalizeFsPath(mutation.oldPath);
  const newPath = normalizeFsPath(mutation.newPath);
  if (
    !isAbsoluteFsPath(oldPath) ||
    !isAbsoluteFsPath(newPath) ||
    oldPath === newPath ||
    isFsPathAtOrBelow(oldPath, newPath)
  ) {
    return null;
  }
  return { ...mutation, oldPath, newPath };
}

function normalizedRemovalPaths(paths: readonly string[]): string[] {
  const normalized = [
    ...new Set(
      paths
        .filter((path) => typeof path === 'string' && isAbsoluteFsPath(path))
        .map(normalizeFsPath)
    ),
  ].sort((left, right) => left.length - right.length);

  return normalized.filter(
    (path, index) =>
      !normalized
        .slice(0, index)
        .some((parent) => isFsPathAtOrBelow(parent, path))
  );
}

function normalizedAllowedRoots(roots: readonly string[]): string[] | null {
  const normalized = roots.map(normalizeFsPath);
  if (normalized.some((root) => !isAbsoluteFsPath(root))) return null;
  return [...new Set(normalized)];
}

export function createPathMutationCoordinator(): PathMutationCoordinator {
  const participants = new Map<string, PathMutationParticipant>();
  let allowedRoots: string[] | null = null;

  const prepare = (
    callback: (participant: PathMutationParticipant) =>
      | PreparedPathMutation
      | void
  ) => {
    const prepared: PreparedPathMutation[] = [];
    for (const participant of participants.values()) {
      const transaction = callback(participant);
      if (transaction) prepared.push(transaction);
    }

    const committed: PreparedPathMutation[] = [];
    try {
      for (const transaction of prepared) {
        committed.push(transaction);
        transaction.commit();
      }
    } catch (error) {
      for (const transaction of committed.reverse()) {
        try {
          transaction.rollback();
        } catch {
          // Preserve the original commit error after attempting every rollback.
        }
      }
      throw error;
    }
  };

  return {
    register(participant) {
      participants.set(participant.id, participant);
      return () => {
        if (participants.get(participant.id) === participant) {
          participants.delete(participant.id);
        }
      };
    },
    applyAppMutation(mutation) {
      const normalized = normalizedMutation(mutation);
      if (!normalized) return false;
      prepare((participant) =>
        participant.prepareAppMutation?.(normalized)
      );
      if (allowedRoots) {
        allowedRoots = [
          ...new Set(
            allowedRoots.map((root) =>
              remapFsPath(root, normalized.oldPath, normalized.newPath)
            )
          ),
        ];
      }
      return true;
    },
    applyExternalRemoval(paths) {
      const normalized = normalizedRemovalPaths(paths);
      if (normalized.length === 0) return false;
      prepare((participant) =>
        participant.preparePathRemoval?.(normalized, 'external')
      );
      return true;
    },
    applyRootRemoval(rootPath) {
      const normalized = normalizedRemovalPaths([rootPath]);
      if (normalized.length !== 1) return false;
      const removedRoot = normalized[0];
      prepare((participant) =>
        participant.preparePathRemoval?.(normalized, 'root-removed')
      );
      if (allowedRoots) {
        allowedRoots = allowedRoots.filter(
          (root) => !isFsPathAtOrBelow(removedRoot, root)
        );
      }
      return true;
    },
    reconcileAllowedRoots(roots) {
      const normalized = normalizedAllowedRoots(roots);
      if (!normalized) return false;
      prepare((participant) =>
        participant.prepareAllowedRoots?.(normalized)
      );
      allowedRoots = normalized;
      return true;
    },
    getAllowedRoots() {
      return allowedRoots ? [...allowedRoots] : null;
    },
  };
}

export const pathMutationCoordinator = createPathMutationCoordinator();

pathMutationCoordinator.register({
  id: 'files-location-snapshots',
  prepareAppMutation: ({ oldPath, newPath }) => {
    const rollback = filesLocationSnapshots.checkpoint();
    return {
      commit: () => filesLocationSnapshots.remapSubtree(oldPath, newPath),
      rollback,
    };
  },
  preparePathRemoval: (paths) => {
    const rollback = filesLocationSnapshots.checkpoint();
    return {
      commit: () => filesLocationSnapshots.removeSubtrees(paths),
      rollback,
    };
  },
  prepareAllowedRoots: (roots) => {
    const rollback = filesLocationSnapshots.checkpoint();
    return {
      commit: () => filesLocationSnapshots.retainRoots(roots),
      rollback,
    };
  },
});
