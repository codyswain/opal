import React, { useState } from "react";
import { Input } from "@/renderer/shared/components/Input";
import { Button } from "@/renderer/shared/components/Button";
import { Eye, EyeOff } from "lucide-react";
import { useSettings } from "../context/SettingsContext";

export const Settings: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const [showApiKey, setShowApiKey] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [embeddingsStatus, setEmbeddingsStatus] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const handleSave = () => {
    updateSettings({ openAIKey: settings.openAIKey });
  };

  const toggleApiKeyVisibility = () => {
    setShowApiKey(!showApiKey);
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
          setResetStatus(`Database reset failed: ${result.message || 'Unknown error'}`);
        }
      } catch (error) {
        setResetStatus(`Database reset error: ${error}`);
      }
    }
  };
  
  const handleBackupDatabase = async () => {
    setBackupStatus('Backup in progress...');
    try {
      const result = await window.databaseAPI.backupDatabase();
      if (result.success && result.filePath) {
        setBackupStatus(`Backup created successfully at ${result.filePath}!`);
      } else {
        setBackupStatus(`Backup failed: ${result.message || 'Unknown error'}`);
      }
    } catch (error) {
      setBackupStatus(`Backup error: ${error}`);
    }
  };

  const handleRebuildEmbeddings = async () => {
    // Show confirmation dialog
    if (window.confirm('Are you sure you want to rebuild all note embeddings? This may take a while but can fix issues with related notes.')) {
      setEmbeddingsStatus('Rebuilding embeddings in progress...');
      
      try {
        // Check if the clearVectorIndex function exists
        if (!window.electron.clearVectorIndex) {
          setEmbeddingsStatus('This version of the application does not support the rebuild embeddings feature yet. Please restart the application first.');
          return;
        }
        
        // First, clear the vector index
        const clearResult = await window.electron.clearVectorIndex();
        if (!clearResult.success) {
          setEmbeddingsStatus(`Failed to clear vector index: ${clearResult.message}`);
          return;
        }
        
        // Check if the regenerateAllEmbeddings function exists
        if (!window.electron.regenerateAllEmbeddings) {
          setEmbeddingsStatus('This version of the application does not support the regenerate embeddings feature yet. Please restart the application first.');
          return;
        }
        
        // Then regenerate all embeddings
        const result = await window.electron.regenerateAllEmbeddings();
        if (result.success) {
          setEmbeddingsStatus(`Successfully rebuilt embeddings for ${result.count} notes. Related notes should now work properly.`);
        } else {
          setEmbeddingsStatus(`Failed to rebuild embeddings: ${result.message}`);
        }
      } catch (error) {
        setEmbeddingsStatus(`Error rebuilding embeddings: ${error}`);
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
          Manage your database settings and perform maintenance tasks.
        </p>
        <div className="flex flex-col space-y-4">
          <button
            onClick={handleBackupDatabase}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Backup Database
          </button>
          {backupStatus && (
            <div className={`p-2 rounded ${backupStatus.includes('failed') || backupStatus.includes('error') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
              {backupStatus}
            </div>
          )}
          
          <button
            onClick={handleRebuildEmbeddings}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Fix Related Notes (Rebuild Embeddings)
          </button>
          {embeddingsStatus && (
            <div className={`p-2 rounded ${embeddingsStatus.includes('Failed') || embeddingsStatus.includes('Error') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
              {embeddingsStatus}
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