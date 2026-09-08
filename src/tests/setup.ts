import { expect, afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Clean up after each test
afterEach(() => {
  cleanup();
}); 
// Per-folder toolbar state is session-scoped in the app; tests must not share it.
import { useFolderViewStore } from '@/renderer/features/disk-explorer/store/folderViewStore';
beforeEach(() => { useFolderViewStore.getState().reset(); });
