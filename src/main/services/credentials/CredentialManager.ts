import * as keytar from "keytar";
import logger from "@/main/logger";
import { CredentialAccount } from "@/types/credentials";
import { APP_NAME } from "@/common/constants";

const APP_KEYTAR_SERVICE = `${APP_NAME}App`;

/**
 * This class is responsible for storing and retrieving credentials for the
 * application, using the keytar library which is a cross-platform library.
 *
 * @example
 * ```typescript
 * const cm = CredentialManager.getInstance();
 * await cm.setCredential(CredentialAccount.OPENAI, 'my-key-value');
 * const openaiKey = await cm.getCredential(CredentialAccount.OPENAI);
 * ```
 */

export class CredentialManager {
  private static instance: CredentialManager;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getInstance(): CredentialManager {
    if (!CredentialManager.instance) {
      CredentialManager.instance = new CredentialManager();
    }
    return CredentialManager.instance;
  }

  public async getCredential(
    account: CredentialAccount
  ): Promise<string | null> {
    try {
      const secret = await keytar.getPassword(APP_KEYTAR_SERVICE, account);
      return secret;
    } catch (error) {
      logger.error(
        `Error retrieving credential for account "${account}":`,
        error
      );
      return null;
    }
  }

  public async setCredential(
    account: CredentialAccount,
    secret: string
  ): Promise<void> {
    if (!secret) {
      const errorMsg =
        "Attempted to set an empty secret. Use deleteCredential() instead.";
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    try {
      await keytar.setPassword(APP_KEYTAR_SERVICE, account, secret);
      logger.info(`Credential set for account "${account}".`);
    } catch (error) {
      logger.error(`Error setting credential for account "${account}":`, error);
      throw error;
    }
  }

  public async deleteCredential(account: CredentialAccount): Promise<void> {
    try {
      await keytar.deletePassword(APP_KEYTAR_SERVICE, account);
      logger.info(`Credential deleted for account "${account}".`);
    } catch (error) {
      logger.error(
        `Error deleting credential for account "${account}":`,
        error
      );
      throw error;
    }
  }
}
