import { create } from "zustand";
import { readPref, writePref } from "@/renderer/shared/prefs/prefs";
import { usePaletteStore } from "@/renderer/features/commands/store/paletteStore";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";

interface PrivacyState {
  shielded: boolean;
  shield: () => void;
  reveal: () => void;
  toggle: () => void;
}

export const usePrivacyStore = create<PrivacyState>((set, get) => ({
  shielded: readPref<boolean>("privacy.shield", false) === true,
  shield: () => {
    // Close transient surfaces before the display shield goes up.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    usePaletteStore.getState().hide();
    useDiskStore.getState().setQuickPreviewPath(null);
    writePref("privacy.shield", true);
    set({ shielded: true });
  },
  reveal: () => {
    writePref("privacy.shield", false);
    set({ shielded: false });
  },
  toggle: () => (get().shielded ? get().reveal() : get().shield()),
}));
