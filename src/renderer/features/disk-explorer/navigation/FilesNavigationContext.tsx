import { createContext, useContext } from 'react';
import { recordOpened } from '../activity/recordActivity';
import { useDiskStore } from '../store/diskStore';
import { useTabsStore, type OpenOptions } from '../store/tabsStore';
import {
  directoryCollection,
  fileLocation,
  type FilesCollection,
} from './filesLocation';

/** Opens show in the active tab; `newTab` opens beside it instead. */
export type FilesOpenOptions = Pick<OpenOptions, 'newTab'>;

export interface FilesNavigationActions {
  navigateDirectory(path: string, options?: FilesOpenOptions): void;
  /** Browse Recent or a query collection; records no activity. */
  navigateCollection(collection: FilesCollection): void;
  openFile(path: string, options?: FilesOpenOptions): void;
}

/**
 * The tabs store is the navigation model; the files route mirrors it into the
 * URL and loads what the active tab shows. Without that route (stores and
 * standalone explorer tests) the folder is applied directly.
 */
const localActions: FilesNavigationActions = {
  navigateDirectory(path, options) {
    recordOpened(path);
    useTabsStore
      .getState()
      .open({ mode: 'browse', collection: directoryCollection(path) }, options);
    useDiskStore.getState().navigateToDirectory(path);
  },
  navigateCollection(collection) {
    useTabsStore.getState().open({ mode: 'browse', collection });
    useDiskStore.getState().navigateToCollection(collection);
  },
  openFile(path, options) {
    recordOpened(path);
    useTabsStore.getState().open(fileLocation(path), options);
  },
};
export const FilesNavigationContext =
  createContext<FilesNavigationActions>(localActions);
export const useFilesNavigation = () => useContext(FilesNavigationContext);
