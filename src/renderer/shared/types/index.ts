import type { ThemeReport } from '@/common/theme';
import { CredentialAccount } from "@/types/credentials";

declare global {
  interface Window {
    systemAPI: {
      reportTheme: (report: ThemeReport) => void;
      openFolderDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      createDirectoryOnDisk: (dirPath: string) => Promise<{ success: boolean, error?: string }>;
      reportCommands: (commands: Array<{ id: string; label: string; accelerator?: string }>) => void;
      onMenuCommand: (handler: (commandId: string) => void) => () => void;
    };

    credentialAPI: {
      getKey: (account: CredentialAccount) => Promise<string>;
      setKey: (account: CredentialAccount, password: string) => Promise<void>;
      deleteKey: (account: CredentialAccount) => Promise<void>;
    };
  }
}

// This ensures the file is treated as a module.
export {};
