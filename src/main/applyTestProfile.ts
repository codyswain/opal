// Imported first by main.ts so the paths move before any other module reads
// app.getPath('userData') at load time (the logger does).
import { app } from 'electron';
import { applyTestProfile } from '@/main/testProfile';

applyTestProfile(process.env, app);
