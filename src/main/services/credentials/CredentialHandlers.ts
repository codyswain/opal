import { IpcMain } from "electron";
import { CredentialManager } from "@/main/services/credentials/CredentialManager";
import { CredentialAccount } from "@/types/credentials";
import { IPCResponse } from "@/types/ipc";

interface CredentialHandlerDependencies {
  ipc: IpcMain; 
  credentialManager: CredentialManager;
}

export class CredentialHandlers {
  private deps: CredentialHandlerDependencies;

  constructor(deps: CredentialHandlerDependencies) {
    this.deps = deps;
  }

  registerAll(): void {
    this.registerGetCredential();
    this.registerSetCredential();
    this.registerDeleteCredential();
  }

  private registerGetCredential(): void {
    this.deps.ipc.handle(
      `credentials:get`,
      async (_, account: CredentialAccount): Promise<IPCResponse<string>> => {
        const credential = await this.deps.credentialManager.getCredential(account);
        return { success: true, data: credential };
      }
    );
  }

  private registerSetCredential(): void {
    this.deps.ipc.handle(
      `credentials:set`,
      async (
        _,
        account: CredentialAccount,
        password: string
      ): Promise<IPCResponse> => {
        await this.deps.credentialManager.setCredential(account, password);
        return { success: true };
      }
    );
  }

  private registerDeleteCredential(): void {
    this.deps.ipc.handle(
      `credentials:delete`,
      async (_, account: CredentialAccount): Promise<IPCResponse> => {
        await this.deps.credentialManager.deleteCredential(account);
        return { success: true };
      }
    );
  }
}
