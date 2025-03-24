import React, { useRef, useEffect, useState } from "react";
import { cn } from "@/renderer/shared/utils";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { Button } from "@/renderer/shared/components/Button";
import { Input } from "@/renderer/shared/components/Input";
import { Send, RefreshCw, Bot, MessageSquare, Plus, History } from "lucide-react";
import { toast } from "@/renderer/shared/components/Toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { v4 as uuidv4 } from "uuid";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";
import { MessageList } from "./chat/MessageList";
import { ChatInputBar } from "./chat/ChatInputBar";
import { ConversationsList } from "./chat/ConversationsList";
import { useChatService } from "./chat/useChatService";

interface ChatPaneProps {
  onClose: () => void;
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

const ChatPane: React.FC<ChatPaneProps> = ({ onClose, isNoteSelected = false, selectedNodeId = null }) => {
  const {
    messages,
    input, 
    setInput,
    isLoading,
    isStreaming,
    conversationId,
    previousConversations,
    showConversations, 
    setShowConversations,
    activeChatView,
    setActiveChatView,
    handleSend,
    loadConversation,
    loadAllConversations,
    startNewConversation,
    switchToConversation
  } = useChatService(isNoteSelected, selectedNodeId);
  
  // Get the selected note info from fileExplorerStore
  const { ui, entities } = useFileExplorerStore();
  const selectedId = ui.selectedId;
  const selectedNode = selectedId ? entities.nodes[selectedId] : null;
  const selectedNote = selectedId && selectedNode?.type === 'note' ? entities.notes[selectedId] : null;

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