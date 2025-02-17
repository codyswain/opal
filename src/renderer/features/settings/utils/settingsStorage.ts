import { Settings } from '../types';

export const getSettings = async (): Promise<Settings> => {
  const openAIKey = await window.electron.getOpenAIKey();
  return { openAIKey: openAIKey || '' };
};

export const saveSettings = async (settings: Settings): Promise<void> => {
  await window.electron.setOpenAIKey(settings.openAIKey);
};