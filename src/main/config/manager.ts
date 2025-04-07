import { app } from 'electron';
import path from 'path';
import log from 'electron-log';

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
log.info(`Initialized CONFIG_FILE=${CONFIG_FILE}`);