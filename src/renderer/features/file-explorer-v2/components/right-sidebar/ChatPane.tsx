import React, { useEffect } from "react";
import { Button } from "@/renderer/shared/components/Button";
import { Plus, History } from "lucide-react";
import { useChatService } from "./chat/useChatService";
import { MessageList } from "./chat/MessageList";
import { ChatInputBar } from "./chat/ChatInputBar";
import { ConversationsList } from "./chat/ConversationsList";

interface ChatPaneProps {
  isNoteSelected?: boolean;
  selectedNodeId?: string | null;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  id?: string;
  created_at?: string;
  __updateKey?: number;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  last_message_at: string;
  message_count: number;
}

const ChatPane: React.FC<ChatPaneProps> = ({ isNoteSelected = false, selectedNodeId = null }) => {
  const {
    messages,
    input, 
    setInput,
    isLoading,
    isStreaming,
    previousConversations,
    showConversations, 
    setShowConversations,
    activeChatView,
    setActiveChatView,
    handleSend,
    loadAllConversations,
    startNewConversation,
    switchToConversation
  } = useChatService(selectedNodeId);
  
  // Get the selected note info from fileExplorerStore
  // const { ui, entities } = useFileExplorerStore(); // Removed unused
  // const selectedId = ui.selectedId; // Removed unused

  // Add useEffect to handle note selection
  useEffect(() => {
    if (isNoteSelected && selectedNodeId) {
      // If a note is selected, start a new chat
      startNewConversation();
      setActiveChatView('chat');
      setShowConversations(false);
    } else {
      // If a folder is selected, show conversations
      setActiveChatView('conversations');
      setShowConversations(true);
    }
  }, [isNoteSelected, selectedNodeId]);

  const getSortedConversations = () => {
    return [...previousConversations].sort((a, b) => 
      new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    );
  };

  // Render the chat interface
  return (
    <div className="flex flex-col h-full relative">
      {activeChatView === 'conversations' ? (
        <ConversationsList 
          conversations={getSortedConversations()}
          switchToConversation={switchToConversation}
          startNewConversation={startNewConversation}
        />
      ) : (
        <>
          <div className="absolute z-10 top-0 right-0 p-1 flex space-x-1">
            {!showConversations && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 opacity-60 hover:opacity-100" 
                onClick={() => {
                  setActiveChatView('conversations');
                  setShowConversations(true);
                  loadAllConversations();
                }}
              >
                <History className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-60 hover:opacity-100" 
              onClick={startNewConversation}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        
          <MessageList 
            messages={messages} 
            isLoading={isLoading} 
            isStreaming={isStreaming} 
          />
          
          <ChatInputBar 
            input={input}
            setInput={setInput}
            handleSend={handleSend}
            isLoading={isLoading}
          />
        </>
      )}
    </div>
  );
};

export default ChatPane; 