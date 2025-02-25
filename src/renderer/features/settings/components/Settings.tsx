import React, { useState } from "react";
import { Input } from "@/renderer/shared/components/Input";
import { Button } from "@/renderer/shared/components/Button";
import { Eye, EyeOff } from "lucide-react";
import { useSettings } from "../context/SettingsContext";

export const Settings: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const [showApiKey, setShowApiKey] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<string | null>(null);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  const handleSave = () => {
    updateSettings({ openAIKey: settings.openAIKey });
  };

  const toggleApiKeyVisibility = () => {
    setShowApiKey(!showApiKey);
  };

  const handleMigration = async () => {
    setMigrationStatus('Migration in progress...');
    try {
      const result = await window.databaseAPI.triggerMigration();
      if (result.success) {
        setMigrationStatus('Migration completed successfully!');
      } else {
        setMigrationStatus(`Migration failed: ${result.error}`);
      }
    } catch (error) {
      setMigrationStatus(`Migration error: ${error}`);
    }
  };

  const handleCleanup = async () => {
    setCleanupStatus('Cleanup in progress...');
    try {
      const result = await window.databaseAPI.cleanupOldNotes();
      if (result.success) {
        setCleanupStatus('Old notes cleaned up successfully!');
      } else {
        setCleanupStatus(`Cleanup failed: ${result.error}`);
      }
    } catch (error) {
      setCleanupStatus(`Cleanup error: ${error}`);
    }
  };

  const handleResetDatabase = async () => {
    // Show confirmation dialog
    if (window.confirm('Are you sure you want to reset the database? This will delete all data in the database.')) {
      setResetStatus('Database reset in progress...');
      try {
        const result = await window.databaseAPI.resetDatabase();
        if (result.success) {
          setResetStatus('Database reset successfully! You can now migrate your notes again.');
        } else {
          setResetStatus(`Database reset failed: ${result.error}`);
        }
      } catch (error) {
        setResetStatus(`Database reset error: ${error}`);
      }
    }
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
      <div className="mt-8 border-t pt-6">
        <h2 className="text-xl font-semibold mb-4">Database Management</h2>
        <p className="mb-4">
          Manage your database and migrate notes from the file system to the SQLite database for improved performance and reliability.
        </p>
        <div className="flex flex-col space-y-4">
          <button
            onClick={handleMigration}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Migrate Notes to Database
          </button>
          {migrationStatus && (
            <div className={`p-2 rounded ${migrationStatus.includes('failed') || migrationStatus.includes('error') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
              {migrationStatus}
            </div>
          )}
          
          <button
            onClick={handleCleanup}
            className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
          >
            Clean Up Old Notes
          </button>
          {cleanupStatus && (
            <div className={`p-2 rounded ${cleanupStatus.includes('failed') || cleanupStatus.includes('error') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
              {cleanupStatus}
            </div>
          )}
          
          <div className="mt-4 pt-4 border-t border-gray-200">
            <h3 className="text-lg font-semibold mb-2 text-red-600">Danger Zone</h3>
            <p className="mb-4 text-sm text-gray-600">
              These actions cannot be undone. Be careful!
            </p>
            <button
              onClick={handleResetDatabase}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Reset Database
            </button>
            {resetStatus && (
              <div className={`mt-2 p-2 rounded ${resetStatus.includes('failed') || resetStatus.includes('error') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                {resetStatus}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};