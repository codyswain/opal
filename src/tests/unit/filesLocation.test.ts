import { describe, expect, it } from 'vitest';
import {
  FILES_ARIA_CONTRACT,
  RECENT_COLLECTION,
  browseFiles,
  collectionKey,
  directoryCollection,
  filesLocationKey,
  locationDirectory,
  focusFile,
  parseFilesLocation,
  remapFilesLocation,
  resolveFilesInteraction,
  resolveFilesLocation,
  sameCollection,
  serializeFilesLocation,
  stateFromFilesLocation,
  toFilesRouterUpdate,
} from '@/renderer/features/disk-explorer/navigation/filesLocation';
import {
  createFilesLocationSnapshotStore,
  focusAfterFilter,
  focusAfterNavigation,
  focusAfterRemoval,
  sanitizeFilesLocationSnapshot,
} from '@/renderer/features/disk-explorer/navigation/filesLocationSnapshots';

const ROOT = '/Vault';
const NOTES = '/Vault/Notes';
const FILE = '/Vault/Notes/Today #1%.md';

describe('files router locations', () => {
  it('round-trips browse and focus paths with reserved characters', () => {
    const browse = { mode: 'browse' as const, collection: directoryCollection(NOTES)};
    const focus = { mode: 'focus' as const, collection: directoryCollection(NOTES), file: FILE };

    expect(parseFilesLocation(serializeFilesLocation(browse), [ROOT])).toEqual(
      browse
    );
    expect(parseFilesLocation(serializeFilesLocation(focus), [ROOT])).toEqual(
      focus
    );
  });

  it('normalizes Windows separators and equivalent location keys', () => {
    const parsed = parseFilesLocation(
      '?mode=browse&dir=C%3A%5CVault%5CNotes%5C',
      ['C:/Vault']
    );
    expect(parsed).toEqual({
      mode: 'browse',
      collection: directoryCollection('C:/Vault/Notes'),
    });
    expect(
      filesLocationKey({ mode: 'browse', collection: directoryCollection('C:\\Vault\\Notes\\')})
    ).toBe(
      filesLocationKey({ mode: 'browse', collection: directoryCollection('C:/Vault/Notes')})
    );
  });

  it.each([
    [''],
    ['?mode=browse'],
    ['?mode=unknown&dir=%2FVault'],
    ['?mode=focus&dir=%2FVault%2FNotes'],
    ['?mode=browse&dir=%2FOutside'],
    [
      '?mode=focus&dir=%2FVault%2FNotes&file=%2FOtherRoot%2Fsecret.md',
    ],
    ['?mode=focus&dir=%2FVault%2FNotes&file=%2FVault%2FNotes'],
  ])('rejects malformed or disallowed state: %s', (search) => {
    expect(parseFilesLocation(search, [ROOT])).toBeNull();
  });

  it('replaces an invalid location with the first open root', () => {
    expect(resolveFilesLocation('?mode=browse&dir=%2FOutside', [ROOT])).toEqual(
      {
        location: { mode: 'browse', collection: directoryCollection(ROOT)},
        history: 'replace',
      }
    );
    expect(resolveFilesLocation('', [])).toBeNull();
  });

  it('marks non-canonical but valid search state for replacement', () => {
    expect(
      resolveFilesLocation(`dir=${encodeURIComponent(NOTES)}&mode=browse`, [
        ROOT,
      ])
    ).toEqual({
      location: { mode: 'browse', collection: directoryCollection(NOTES)},
      history: 'replace',
    });
    expect(
      resolveFilesLocation(
        serializeFilesLocation({ mode: 'browse', collection: directoryCollection(NOTES)}),
        [ROOT]
      )?.history
    ).toBe('none');
  });

  it('turns push and replace intents into router updates, but ignores none', () => {
    expect(toFilesRouterUpdate(browseFiles(NOTES))).toMatchObject({
      pathname: '/files',
      replace: false,
    });
    expect(toFilesRouterUpdate(focusFile(NOTES, FILE, 'replace'))).toMatchObject(
      {
        pathname: '/files',
        replace: true,
      }
    );
    expect(toFilesRouterUpdate(browseFiles(NOTES, 'none'))).toBeNull();
  });

  it('remaps the active location with replace semantics', () => {
    const current = { mode: 'focus' as const, collection: directoryCollection(NOTES), file: FILE };
    const intent = remapFilesLocation(
      current,
      '/Vault/Notes',
      '/Vault/Writing'
    );

    expect(intent).toEqual({
      location: {
        mode: 'focus',
        collection: directoryCollection('/Vault/Writing'),
        file: '/Vault/Writing/Today #1%.md',
      },
      history: 'replace',
    });
    expect(stateFromFilesLocation(intent.location)).toEqual({
      currentDirectory: '/Vault/Writing',
      openedPath: '/Vault/Writing/Today #1%.md',
    });
  });
});

describe('files interaction contract', () => {
  it.each([
    ['file', 'single-click', 'select'],
    ['file', 'double-click', 'open-file'],
    ['file', 'open', 'open-file'],
    ['file', 'return', 'rename'],
    ['file', 'space', 'quick-preview'],
    ['directory', 'single-click', 'select'],
    ['directory', 'double-click', 'navigate-directory'],
    ['directory', 'open', 'navigate-directory'],
    ['directory', 'return', 'rename'],
    ['directory', 'space', 'none'],
    ['sidebar-directory', 'single-click', 'navigate-directory'],
    ['sidebar-directory', 'double-click', 'navigate-directory'],
    ['sidebar-directory', 'return', 'none'],
    ['open-file-tab', 'single-click', 'activate-tab'],
    ['open-file-tab', 'double-click', 'activate-tab'],
    ['open-file-tab', 'space', 'none'],
  ] as const)(
    '%s + %s resolves to %s',
    (targetKind, activation, expectedType) => {
      expect(
        resolveFilesInteraction({
          targetKind,
          activation,
          path: targetKind === 'file' ? FILE : NOTES,
          currentDirectory: NOTES,
        }).type
      ).toBe(expectedType);
    }
  );

  it('uses push history only for explicit browse and focus navigation', () => {
    const selected = resolveFilesInteraction({
      targetKind: 'file',
      activation: 'single-click',
      path: FILE,
      currentDirectory: NOTES,
    });
    const opened = resolveFilesInteraction({
      targetKind: 'file',
      activation: 'open',
      path: FILE,
      currentDirectory: NOTES,
    });

    expect('navigation' in selected).toBe(false);
    expect(opened).toMatchObject({
      type: 'open-file',
      navigation: { history: 'push' },
    });
  });

  it('records the chosen virtualized ARIA patterns', () => {
    expect(FILES_ARIA_CONTRACT).toEqual({
      directoryTreeRole: 'tree',
      detailsCollectionRole: 'grid',
      galleryCollectionRole: 'grid',
      multiselectable: true,
      focusStrategy: 'aria-activedescendant',
    });
  });
});

describe('location snapshots', () => {
  const browse = { mode: 'browse' as const, collection: directoryCollection(NOTES)};
  const snapshot = {
    selectedPaths: [FILE],
    focusedPath: FILE,
    scroll: { view: 'details' as const, offset: 240 },
  };

  it('captures selection and scroll without creating navigation state', () => {
    const store = createFilesLocationSnapshotStore();
    store.capture(browse, snapshot);

    expect(store.read(browse)).toEqual(snapshot);
  });

  it('drops snapshot paths outside the represented directory', () => {
    const store = createFilesLocationSnapshotStore();
    store.capture(browse, {
      selectedPaths: [FILE, '/Outside/secret.md'],
      focusedPath: '/Outside/secret.md',
      scroll: null,
    });

    expect(store.read(browse)).toEqual({
      selectedPaths: [FILE],
      focusedPath: null,
      scroll: null,
    });
  });

  it('returns defensive copies', () => {
    const store = createFilesLocationSnapshotStore();
    store.capture(browse, snapshot);
    const restored = store.read(browse);
    restored?.selectedPaths.push('/Vault/injected.md');

    expect(store.read(browse)?.selectedPaths).toEqual([FILE]);
  });

  it('caps snapshots with least-recently-used eviction', () => {
    const store = createFilesLocationSnapshotStore(2);
    const one = { mode: 'browse' as const, collection: directoryCollection('/Vault/One')};
    const two = { mode: 'browse' as const, collection: directoryCollection('/Vault/Two')};
    const three = { mode: 'browse' as const, collection: directoryCollection('/Vault/Three')};
    store.capture(one, snapshot);
    store.capture(two, snapshot);
    store.read(one);
    store.capture(three, snapshot);

    expect(store.read(one)).not.toBeNull();
    expect(store.read(two)).toBeNull();
    expect(store.read(three)).not.toBeNull();
  });

  it('remaps location keys and embedded selection paths', () => {
    const store = createFilesLocationSnapshotStore();
    store.capture(browse, snapshot);
    store.remapSubtree('/Vault/Notes', '/Vault/Writing');

    expect(store.read(browse)).toBeNull();
    expect(
      store.read({ mode: 'browse', collection: directoryCollection('/Vault/Writing')})
    ).toEqual({
      selectedPaths: ['/Vault/Writing/Today #1%.md'],
      focusedPath: '/Vault/Writing/Today #1%.md',
      scroll: snapshot.scroll,
    });
  });

  it('purges invalid locations and only stale paths in surviving snapshots', () => {
    const store = createFilesLocationSnapshotStore();
    store.capture(browse, snapshot);
    const rootBrowse = { mode: 'browse' as const, collection: directoryCollection(ROOT)};
    store.capture(rootBrowse, {
      selectedPaths: [FILE, '/Vault/keep.md'],
      focusedPath: FILE,
      scroll: null,
    });
    store.removeSubtrees(['/Vault/Notes']);

    expect(store.read(browse)).toBeNull();
    expect(store.read(rootBrowse)).toEqual({
      selectedPaths: ['/Vault/keep.md'],
      focusedPath: '/Vault/keep.md',
      scroll: null,
    });
  });

  it('drops location records outside the currently allowed roots', () => {
    const store = createFilesLocationSnapshotStore();
    store.capture(browse, snapshot);
    store.retainRoots(['/Other']);

    expect(store.size()).toBe(0);
  });

  it('sanitizes corrupt snapshot input', () => {
    expect(
      sanitizeFilesLocationSnapshot({
        selectedPaths: [FILE, 42, 'relative.md', FILE],
        focusedPath: 42,
        scroll: { view: 'details', offset: -1 },
      })
    ).toEqual({
      selectedPaths: [FILE],
      focusedPath: null,
      scroll: null,
    });
  });
});

describe('collection focus fallback', () => {
  const previousVisiblePaths = ['/V/a', '/V/b', '/V/c'];

  it('selects the next row after the focused row is removed', () => {
    expect(
      focusAfterRemoval({
        previousVisiblePaths,
        visiblePaths: ['/V/a', '/V/c'],
        focusedPath: '/V/b',
        selectedPaths: ['/V/b'],
      })
    ).toEqual({ focusedPath: '/V/c', selectedPaths: ['/V/c'] });
  });

  it('keeps focus but not selection when filtering hides the cursor', () => {
    expect(
      focusAfterFilter({
        previousVisiblePaths,
        visiblePaths: ['/V/a', '/V/c'],
        focusedPath: '/V/b',
        selectedPaths: ['/V/b'],
      })
    ).toEqual({ focusedPath: '/V/c', selectedPaths: [] });
  });

  it('clears collection focus when navigating directories', () => {
    expect(focusAfterNavigation()).toEqual({
      focusedPath: null,
      selectedPaths: [],
    });
  });
});

describe('collections', () => {
  const roots = ['/Vault'];
  it('keeps directory URLs byte-for-byte stable', () => {
    expect(serializeFilesLocation({ mode: 'browse', collection: { kind: 'directory', directory: '/Vault/A' } })).toBe('?mode=browse&dir=%2FVault%2FA');
    expect(serializeFilesLocation({ mode: 'focus', collection: { kind: 'directory', directory: '/Vault' }, file: '/Vault/a.md' })).toBe('?mode=focus&dir=%2FVault&file=%2FVault%2Fa.md');
  });
  it('round-trips recent browse and focus locations', () => {
    const browse = { mode: 'browse' as const, collection: RECENT_COLLECTION };
    expect(serializeFilesLocation(browse)).toBe('?mode=browse&collection=recent');
    expect(parseFilesLocation('?mode=browse&collection=recent', roots)).toEqual(browse);
    const focus = { mode: 'focus' as const, collection: RECENT_COLLECTION, file: '/Vault/a.md' };
    expect(parseFilesLocation(serializeFilesLocation(focus), roots)).toEqual(focus);
    expect(parseFilesLocation('?mode=focus&collection=recent&file=%2FElsewhere%2Fa.md', roots)).toBeNull();
    expect(parseFilesLocation('?mode=browse&collection=unknown', roots)).toBeNull();
    expect(parseFilesLocation('?mode=browse&collection=recent', [])).toBeNull();
  });
  it('remaps only paths and leaves the recent collection alone', () => {
    const focus = { mode: 'focus' as const, collection: RECENT_COLLECTION, file: '/Vault/Old/a.md' };
    expect(remapFilesLocation(focus, '/Vault/Old', '/Vault/New')).toEqual({ location: { ...focus, file: '/Vault/New/a.md' }, history: 'replace' });
    expect(remapFilesLocation({ mode: 'browse', collection: RECENT_COLLECTION }, '/Vault/Old', '/Vault/New').history).toBe('none');
  });
  it('exposes directory helpers', () => {
    expect(locationDirectory({ mode: 'browse', collection: RECENT_COLLECTION })).toBeNull();
    expect(locationDirectory(browseFiles('/Vault/A').location)).toBe('/Vault/A');
    expect(collectionKey(RECENT_COLLECTION)).toBe('recent');
    expect(sameCollection(directoryCollection('/Vault/A/'), directoryCollection('/Vault/A'))).toBe(true);
    expect(sameCollection(RECENT_COLLECTION, null)).toBe(false);
  });
  it('snapshots scope paths to directory collections only and survive root retention', () => {
    const store = createFilesLocationSnapshotStore();
    const recent = { mode: 'browse' as const, collection: RECENT_COLLECTION };
    store.capture(recent, { selectedPaths: ['/Vault/a.md', '/Other/b.md'], focusedPath: '/Vault/a.md', scroll: { view: 'details', offset: 40 } });
    expect(store.read(recent)?.selectedPaths).toEqual(['/Vault/a.md', '/Other/b.md']);
    store.retainRoots(['/Vault']);
    expect(store.read(recent)).toEqual({ selectedPaths: ['/Vault/a.md'], focusedPath: '/Vault/a.md', scroll: { view: 'details', offset: 40 } });
    store.removeSubtrees(['/Vault/a.md']);
    expect(store.read(recent)?.selectedPaths).toEqual([]);
    store.capture({ mode: 'focus', collection: RECENT_COLLECTION, file: '/Vault/gone.md' }, { selectedPaths: [], focusedPath: null, scroll: null });
    store.removeSubtrees(['/Vault/gone.md']);
    expect(store.size()).toBe(1);
  });
});
