import log from 'electron-log';
import path from 'path';
import { app } from 'electron';
import os from 'os';
import fs from 'fs/promises';
import { APP_NAME } from './config/constants';

/* 
  Logging destinations:
  - Windows: C:\Users\<username>\AppData\Local\Opal\logs
  - macOS: ~/Library/Logs/Opal
  - Linux: ~/.local/share/Opal/logs

  For Linux: 
  - XDG = "X Desktop Group"; They agreed on standards for Linux desktop apps
  - including the xdgDataHome variable, which is the preferred location for app data
  - https://specifications.freedesktop.org/basedir-spec/latest/

  Some learnings/review: 
  - The logger is a singleton. The constructor is private so the class may
  only be instantiated through the getInstance method. The genInstance method 
  is static meaning it can be called on the class itself, not an instance of the class.

*/

const WINDOWS_FILE_LOG_PATH = path.join(app.getPath('userData'), 'logs');
const MACOS_FILE_LOG_PATH = path.join(os.homedir(), `Library/Logs/${APP_NAME}/${APP_NAME}.log`);
const LINUX_FILE_LOG_PATH = process.env.XDG_DATA_HOME
  ? path.join(process.env.XDG_DATA_HOME, `${APP_NAME}/logs`)
  : path.join(os.homedir(), `.local/share/${APP_NAME}/logs`);

class Logger {
  private static instance: Logger; 

  private constructor(){
    this.configureFileLogger().catch(error => {
      console.error('Failed to configure file logger:', error);
    });
    // this.configureConsoleLogger();
  }

  public static getInstance() {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private async configureFileLogger() {
    log.transports.file.level = 'debug'; 
    log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s}.{ms} [{level}] {text}';
    log.transports.file.maxSize = 5 * 1024 * 1024;

    const platform = os.platform();
    let logFilePath: string;
    switch (platform) {
      case 'win32': {
        logFilePath = WINDOWS_FILE_LOG_PATH;
        break;
      }
      case 'darwin': { // macOS
        logFilePath = MACOS_FILE_LOG_PATH;
        break;
      }
      case 'linux': 
      default: {
        logFilePath = LINUX_FILE_LOG_PATH;
      }
    } 

    const dirPath = path.dirname(logFilePath);
    try {
      await fs.mkdir(dirPath, { recursive: true });
      log.transports.file.resolvePathFn = () => logFilePath;
    } catch (error) {
      console.error(`Failed to create log directory: ${dirPath}`, error);
      throw new Error(`Failed to create log directory: ${error.message}`);
    }
  }

  private configureConsoleLogger() {
    log.transports.console.level = 'debug';
    log.transports.console.format = '{h}:{i}:{s}:{ms} {text}';
  }

  public log(message: string) {
    this.info(message);
  }

  public info(message: string) {
    log.info(message);
  }

  public error(message: string, error?: Error) {
    log.error(message, error);
  }

  public warn(message: string) {
    log.warn(message);
  }

  public debug(message: string) {
    log.debug(message);
  }


}

export default Logger.getInstance(); 