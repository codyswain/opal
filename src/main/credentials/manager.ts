import * as keytar from 'keytar';
import { APP_KEYTAR_SERVICE } from '../config/constants';
import logger from '../logger';
import { CredentialAccount } from '../../types/credentials';

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

  public async getCredential(account: CredentialAccount): Promise<string | null> {
    try {
      const secret = await keytar.getPassword(APP_KEYTAR_SERVICE, account);
      return secret;
    } catch (error) {
      logger.error(`Error retrieving credential for account "${account}":`, error);
      return null; 
    }
  }

  public async setCredential(account: CredentialAccount, secret: string): Promise<void> {
    if (!secret) {
      const errorMsg = 'Attempted to set an empty secret. Use deleteCredential() instead.';
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
      logger.error(`Error deleting credential for account "${account}":`, error);
      throw error;
    }
  }
}