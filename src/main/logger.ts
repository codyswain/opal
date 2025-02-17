import log from 'electron-log';
import path from 'path';
import { app } from 'electron';
import os from 'os';
import { createDirectoryIfNotExists } from '../renderer/shared/utils/fileUtils';

/* 
  Logging destinations:
  - Windows: C:\Users\<username>\AppData\Local\Tread\logs
  - macOS: ~/Library/Logs/Tread
  - Linux: ~/.local/share/Tread/logs

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
const MACOS_FILE_LOG_PATH = path.join(os.homedir(), 'Library/Logs/Tread/tread.log');
const LINUX_FILE_LOG_PATH = process.env.XDG_DATA_HOME
  ? path.join(process.env.XDG_DATA_HOME, 'Tread/logs')
  : path.join(os.homedir(), '.local/share/Tread/logs');

class Logger {
  private static instance: Logger; 

  private constructor(){
    this.configureFileLogger();
    // this.configureConsoleLogger();
  }

  public static getInstance() {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private configureFileLogger(){
    log.transports.file.level = 'debug'; 
    log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s}.{ms} [{level}] {text}';
    log.transports.file.maxSize = 5 * 1024 * 1024;

    const platform = os.platform();
    switch (platform) {
      case 'win32': {
        const dirPath = path.dirname(WINDOWS_FILE_LOG_PATH);
        createDirectoryIfNotExists(dirPath);
        log.transports.file.resolvePathFn = () => WINDOWS_FILE_LOG_PATH;
        break;
      }
      case 'darwin': { // macOS
        const dirPath = path.dirname(MACOS_FILE_LOG_PATH);
        createDirectoryIfNotExists(dirPath);
        log.transports.file.resolvePathFn = () => MACOS_FILE_LOG_PATH;
        break;
      }
      case 'linux': 
      default: {
        const dirPath = path.dirname(LINUX_FILE_LOG_PATH);
        createDirectoryIfNotExists(dirPath);
        log.transports.file.resolvePathFn = () => LINUX_FILE_LOG_PATH;
      }
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

  public error(...message: string[]) {
    log.error(message);
  }

  public warn(message: string) {
    log.warn(message);
  }

  public debug(message: string) {
    log.debug(message);
  }


}

export default Logger.getInstance(); 