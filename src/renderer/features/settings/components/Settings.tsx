import React, { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { IconButton } from "@/renderer/shared/ui";
import { useSettingsStore } from "@/renderer/store/settingsStore";

export const Settings: React.FC = () => {
  const { settings, updateSettings, loading } = useSettingsStore();
  const [showApiKey, setShowApiKey] = useState(false);
  const keyId = useId();

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <h2 className="text-heading font-semibold">Settings</h2>
      <section className="mt-6 space-y-2">
        <label htmlFor={keyId} className="block text-ui font-medium">
          OpenAI API key
        </label>
        <p className="text-control text-foreground-secondary">
          Used by Chat to embed and answer from your library. Stored in the system keychain.
        </p>
        <div className="flex items-center gap-2">
          <input
            id={keyId}
            type={showApiKey ? "text" : "password"}
            value={settings.openAIKey}
            onChange={(event) => updateSettings({ openAIKey: event.target.value })}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
            className="h-control w-full rounded-md border border-border bg-surface px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          <IconButton
            label={showApiKey ? "Hide API key" : "Show API key"}
            onClick={() => setShowApiKey((previous) => !previous)}
          >
            {showApiKey ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
          </IconButton>
        </div>
        {loading.error ? (
          <p role="alert" className="text-control text-destructive">{loading.error}</p>
        ) : null}
      </section>
    </div>
  );
};
