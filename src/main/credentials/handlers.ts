import { ipcMain } from "electron";
import { CredentialManager } from "./manager";
import { CredentialAccount } from "../../types/credentials";

export async function registerCredentialIPCHandlers(){
  ipcMain.handle("get-key", async (_, account: CredentialAccount) => {
    const credentialManager = CredentialManager.getInstance();
    return await credentialManager.getCredential(account);
  });

  ipcMain.handle("set-key", async (_, account: CredentialAccount, password: string) => {
    const credentialManager = CredentialManager.getInstance();
    await credentialManager.setCredential(account, password);
  });

  ipcMain.handle("delete-key", async (_, account: CredentialAccount) => {
    const credentialManager = CredentialManager.getInstance();
    await credentialManager.deleteCredential(account);
  });
}