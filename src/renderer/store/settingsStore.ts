import { CredentialAccount } from "@/types/credentials";
import { create } from "zustand";

interface Settings {
  openAIKey: string;
}

export interface SettingsState {
  settings: Settings;
  loading: {
    isLoading: boolean;
    error: string | null;
  };
}

export interface SettingsActions {
  loadSettings: () => Promise<void>;
  updateSettings: (newSettings: Partial<Settings>) => Promise<void>;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: {
    openAIKey: "",
  },
  loading: {
    isLoading: false,
    error: null,
  },

  loadSettings: async () => {
    set({ loading: { isLoading: true, error: null } });
    try {
      const key = await window.credentialAPI.getKey(CredentialAccount.OPENAI);
      set({
        settings: { ...get().settings, openAIKey: key || "" },
        loading: { isLoading: false, error: null },
      });
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to load settings";
      console.error("Failed to load settings:", err);
      set({ loading: { isLoading: false, error: errorMsg } });
    }
  },

  updateSettings: async (newSettings) => {
    // 1. Calculate the next state
    const currentState = get().settings;
    const updatedSettings = { ...currentState, ...newSettings };

    // 2. Update local Zustand state optimistically
    set({
      settings: updatedSettings,
      loading: { isLoading: true, error: null },
    });

    try {
      // 3. Persist the updates
      if (
        newSettings.openAIKey !== undefined &&
        newSettings.openAIKey !== currentState.openAIKey
      ) {
        await window.credentialAPI.setKey(CredentialAccount.OPENAI, updatedSettings.openAIKey);
      } 
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to save settings";
      console.error("Failed to save settings:", err);
      // Revert the optimistic update on failure
      set({
        settings: currentState,
        loading: { isLoading: false, error: errorMsg },
      });
    }
  },
}));
