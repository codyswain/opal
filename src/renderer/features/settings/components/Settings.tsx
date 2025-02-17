import React, { useState } from "react";
import { Input } from "@/renderer/shared/components/Input";
import { Button } from "@/renderer/shared/components/Button";
import { Eye, EyeOff } from "lucide-react";
import { useSettings } from "../context/SettingsContext";

export const Settings: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const [showApiKey, setShowApiKey] = useState(false);

  const handleSave = () => {
    updateSettings({ openAIKey: settings.openAIKey });
  };

  const toggleApiKeyVisibility = () => {
    setShowApiKey(!showApiKey);
  };

  return (
    <div className="container mx-auto mt-2 pt-12 ">
      <h2 className="text-2xl font-bold mb-4">Settings</h2>
      <div className="mb-4">
        <label htmlFor="apiKey" className="block text-sm font-medium mb-1">
          OpenAI API Key
        </label>
        <div className="flex items-center">
          <div className="flex-grow">
            <Input
              id="apiKey"
              type={showApiKey ? "text" : "password"}
              value={settings.openAIKey}
              onChange={(e) => updateSettings({ openAIKey: e.target.value })}
              className="w-full"
              placeholder="Enter your OpenAI API key"
            />
          </div>
          <button
            type="button"
            onClick={toggleApiKeyVisibility}
            className="ml-2 p-2 focus:outline-none"
          >
            {showApiKey ? (
              <EyeOff className="h-5 w-5 text-gray-400" />
            ) : (
              <Eye className="h-5 w-5 text-gray-400" />
            )}
          </button>
        </div>
      </div>
      <Button onClick={handleSave}>Save</Button>
    </div>
  );
};