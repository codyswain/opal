import type { IPCResponse } from '@/types/ipc';
import type { ThemeReport } from '@/common/theme';
import type { OpenPageRequest } from '@/common/opalLink';
import { CredentialAccount } from "@/types/credentials";

declare global {
  interface Window {
    systemAPI: {
      reportTheme: (report: ThemeReport) => void;
      openFolderDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      createDirectoryOnDisk: (dirPath: string) => Promise<{ success: boolean, error?: string }>;
      reportCommands: (commands: Array<{ id: string; label: string; accelerator?: string; aliases?: string[] }>) => void;
      onMenuCommand: (handler: (commandId: string) => void) => () => void;
      closeWindow: () => void;
      isFullScreen: () => Promise<boolean>;
      onFullScreenChange: (handler: (fullScreen: boolean) => void) => () => void;
      /** Files that opal:// links name. Links that came earlier arrive once this listens. */
      onOpenPage: (handler: (request: OpenPageRequest) => void) => () => void;
    };

    credentialAPI: {
      getKey: (account: CredentialAccount) => Promise<IPCResponse<string>>;
      setKey: (account: CredentialAccount, password: string) => Promise<void>;
      deleteKey: (account: CredentialAccount) => Promise<void>;
    };
  }
}

// This ensures the file is treated as a module.
export {};
