import React, { useRef, useEffect, useState } from "react";
import { cn } from "@/renderer/shared/utils";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import { Button } from "@/renderer/shared/components/Button";
import { Input } from "@/renderer/shared/components/Input";
import { Send, RefreshCw, Info, Bot, Plus, MessageSquare, Clock } from "lucide-react";
import { toast } from "@/renderer/shared/components/Toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { v4 as uuidv4 } from "uuid";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";

interface BottomPaneProps {
  onClose: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  id?: string;
  created_at?: string;
}

interface Conversation {
  conversation_id: string;
  last_updated: string;
  latest_user_message: string;
  message_count: number;
}

const ChatPane: React.FC<BottomPaneProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [conversationId, setConversationId] = useState<string>(() => {
    // Use an existing conversation ID from localStorage or create a new one
    return localStorage.getItem("currentChatConversationId") || uuidv4();
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showConversationHistory, setShowConversationHistory] = useState(true);
  const isInitialMount = useRef(true);

  // Get the selected note info from fileExplorerStore
  const { ui, entities } = useFileExplorerStore();
  const selectedId = ui.selectedId;
  const selectedNode = selectedId ? entities.nodes[selectedId] : null;
  const selectedNote = selectedId && selectedNode?.type === 'note' ? entities.notes[selectedId] : null;

  // Load all conversations for the history view
  const loadAllConversations = async () => {
    try {
      const result = await window.chatAPI.getAllConversations();
      if (result.success) {
        setConversations(result.conversations);
      }
    } catch (error) {
      console.error("Error loading conversation history:", error);
    }
  };

  // Load conversation history when component mounts
  useEffect(() => {
    const loadConversation = async () => {
      try {
        const result = await window.chatAPI.getConversation(conversationId);
        if (result.success) {
          setMessages(result.messages);
          // If we have messages, exit the conversation history view
          if (result.messages.length > 0) {
            setShowConversationHistory(false);
          }
        }
      } catch (error) {
        console.error("Error loading conversation:", error);
      }
    };

    // Save conversation ID to localStorage
    localStorage.setItem("currentChatConversationId", conversationId);
    
    loadConversation();
    loadAllConversations();
  }, [conversationId]);

  useEffect(() => {
    // Show conversation history when no messages in current chat
    setShowConversationHistory(messages.length === 0);
  }, [messages]);

  useEffect(() => {
    // Scroll to bottom whenever messages change
    if (scrollAreaRef.current && !showConversationHistory) {
      const scrollElement = scrollAreaRef.current;
      setTimeout(() => {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }, 100);
    }
  }, [messages, showConversationHistory]);

  // If the chat history is empty, show a welcome message
  useEffect(() => {
    if (messages.length === 0 && !showConversationHistory) {
      setMessages([
        {
          role: "assistant",
          content: "Hello! What would you like to know about your notes?"
        }
      ]);
    }
  }, [messages, showConversationHistory]);

  // Make sure to load the note content if it's not already loaded
  useEffect(() => {
    if (selectedId && selectedNode?.type === 'note' && !entities.notes[selectedId]) {
      // Load the note content
      const loadNote = async () => {
        await useFileExplorerStore.getState().getNote(selectedId);
      };
      loadNote();
    }
  }, [selectedId, selectedNode, entities.notes]);

  // Improved function to open notes by ID that correctly handles the note:// links generated in handlers.ts
  const openNoteById = async (noteId: string) => {
    // The noteId in this case is directly the database item ID from handlers.ts
    // No need to search by metadata - it's the primary key of the item
    if (entities.nodes[noteId]) {
      // The note exists in our store, select it
      await useFileExplorerStore.getState().selectEntry(noteId);
    } else {
      // If not in our store yet, we need to load it first
      try {
        // Attempt to get the note content which should load it into the store
        await useFileExplorerStore.getState().getNote(noteId);
        // Then select it
        await useFileExplorerStore.getState().selectEntry(noteId);
      } catch (error) {
        console.error("Failed to open note:", error);
        toast.error("Note not found or could not be loaded");
      }
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    
    try {
      // Add the user message to the database
      await window.chatAPI.addMessage(conversationId, userMessage.role, userMessage.content);
      
      // Prepare the RAG query with comprehensive context about the current note
      let currentNoteContext = "";
      let systemContext = "You are an AI assistant specialized in helping with notes and knowledge management. ";
      let modifiedQuery = userMessage.content;
      
      // If active note exists, include its complete details
      if (selectedNote && selectedNode) {
        // Prepare note metadata string
        const metadata = selectedNode.metadata || {};
        const createdDate = metadata && 'createdAt' in metadata && metadata.createdAt 
          ? new Date(metadata.createdAt as string).toLocaleDateString() 
          : 'unknown date';
        const updatedDate = metadata && 'updatedAt' in metadata && metadata.updatedAt 
          ? new Date(metadata.updatedAt as string).toLocaleDateString() 
          : 'unknown date';
        const metadataStr = `created on ${createdDate}, last updated on ${updatedDate}`;
        
        // Add detailed information about current note to system context
        systemContext += `The user is currently viewing a note titled "${selectedNode.name}" (ID: ${selectedId})`;
        if (selectedNode.path) {
          systemContext += ` located at path: ${selectedNode.path}`;
        }
        systemContext += `. This note was ${metadataStr}. `;
        
        // Create the current note context section that will be clearly highlighted
        currentNoteContext = `
CURRENT NOTE:
============
Title: ${selectedNode.name}
ID: ${selectedId}
Path: ${selectedNode.path || 'N/A'}
Metadata: ${metadataStr}
Content:
${selectedNote.content.substring(0, 4000)}${selectedNote.content.length > 4000 ? '...' : ''}
============

`;

        // Modify the query to include current note context and user query
        modifiedQuery = `${currentNoteContext}USER QUERY: ${userMessage.content}`;
      } else {
        systemContext += "The user currently doesn't have any specific note open. ";
      }
      
      // Add specific instructions for the AI
      systemContext += "When answering, the CURRENT NOTE section contains the full content of the note the user is currently viewing. " +
                      "You should directly reference this content when answering questions about the current note. " +
                      "Be specific and point to relevant sections. If appropriate, suggest ways to organize or improve their notes. " +
                      "When referencing other notes, use note:// links followed by the exact note ID.";
      
      // Add system context to the final query
      const finalQuery = `SYSTEM CONTEXT: ${systemContext}\n\n${modifiedQuery}`;
      
      // Perform the RAG query with the enhanced context
      const result = await window.chatAPI.performRAG(conversationId, finalQuery);
      
      if (result.success) {
        // Add the assistant's response to the UI
        const assistantMessage: Message = { 
          role: "assistant", 
          content: result.message.content 
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        toast.error("Failed to get response" + (result.error ? `: ${result.error}` : ""));
      }
    } catch (error) {
      console.error("Error in RAG Chat:", error);
      toast.error("Failed to get response. Please try again.");
    } finally {
      setIsLoading(false);
      // Refresh conversation history for next time
      loadAllConversations();
    }
  };

  const renderMessage = (message: Message, index: number) => (
    <div
      key={message.id || index}
      className={cn(
        "mb-3 group",
        message.role === "user" ? "ml-8" : "mr-8"
      )}
    >
      <div className="flex items-start gap-3">
        {message.role === "assistant" && (
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary" />
          </div>
        )}
        <div className={cn(
          "flex-1 px-4 py-2.5 rounded-lg",
          message.role === "user"
            ? "bg-primary/10 text-primary-foreground ml-auto"
            : "bg-muted/30 text-foreground"
        )}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children, ...props }) => {
                if (href?.startsWith("note://")) {
                  const noteId = href.replace("note://", "");
                  return (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        openNoteById(noteId);
                      }}
                      className="text-primary hover:underline"
                      {...props}
                    >
                      {children}
                    </a>
                  );
                }
                return (
                  <a 
                    href={href} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-primary hover:underline"
                    {...props}
                  >
                    {children}
                  </a>
                );
              },
              p: ({ children }) => <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc ml-4 mb-2 text-sm">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal ml-4 mb-2 text-sm">{children}</ol>,
              code: ({ children }) => (
                <code className="bg-muted/50 px-1.5 py-0.5 rounded text-xs font-mono">
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="bg-muted/50 p-3 rounded-md my-2 overflow-x-auto text-xs font-mono">
                  {children}
                </pre>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        {message.role === "user" && (
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <div className="w-4 h-4 rounded-full bg-primary text-[10px] font-medium text-primary-foreground flex items-center justify-center">
              U
            </div>
          </div>
        )}
      </div>
      {message.created_at && (
        <div className={cn(
          "text-[10px] text-muted-foreground mt-1",
          message.role === "user" ? "text-right" : "text-left ml-11"
        )}>
          {new Date(message.created_at).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
          })}
        </div>
      )}
    </div>
  );

  const renderLoader = () => (
    <div className="mb-3 mr-8">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Bot className="w-4 h-4 text-primary animate-pulse" />
        </div>
        <div className="flex-1 px-4 py-2.5 rounded-lg bg-muted/30">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0s' }} />
            <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0.2s' }} />
            <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0.4s' }} />
          </div>
        </div>
      </div>
    </div>
  );

  const startNewConversation = () => {
    const newConversationId = uuidv4();
    setConversationId(newConversationId);
    setMessages([]);
    toast.success("Started a new conversation");
    setShowConversationHistory(false);
  };

  const switchToConversation = (id: string) => {
    setConversationId(id);
    setShowConversationHistory(false);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const renderConversationHistory = () => (
    <div className="flex flex-col space-y-1 px-3 py-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-foreground">Recent Conversations</h3>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={startNewConversation} 
          className="h-6 flex items-center gap-1 text-xs"
        >
          <Plus className="w-3 h-3" />
          New Chat
        </Button>
      </div>

      {conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-muted-foreground text-xs py-4">
          <MessageSquare className="w-8 h-8 mb-2 opacity-50" />
          <p>No conversations yet</p>
          <p className="mt-1">Start a new chat to ask about your notes</p>
        </div>
      ) : (
        conversations.map((convo) => (
          <button
            key={convo.conversation_id}
            onClick={() => switchToConversation(convo.conversation_id)}
            className={cn(
              "flex flex-col text-left p-2 rounded-md hover:bg-muted/50 transition-colors",
              convo.conversation_id === conversationId ? "bg-muted/30" : ""
            )}
          >
            <div className="flex justify-between items-center">
              <div className="font-medium text-xs truncate max-w-[200px]">
                {convo.latest_user_message || "New conversation"}
              </div>
              <div className="text-[10px] text-muted-foreground flex items-center">
                <Clock className="w-3 h-3 mr-1" />
                {formatDate(convo.last_updated)}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {convo.message_count} message{convo.message_count !== 1 ? 's' : ''}
            </div>
          </button>
        ))
      )}
    </div>
  );

  // Start a new conversation when component mounts with a new key
  useEffect(() => {
    // Skip on initial mount to prevent overriding the conversation loaded from localStorage
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    
    startNewConversation();
  }, []);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex justify-between items-center h-8 px-3 border-b border-border bg-background/95">
        <div className="flex items-center gap-2">
          <Bot className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground">Note Assistant</h3>
          {selectedNote && selectedNode && !showConversationHistory && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/30 text-[10px]">
              <Info className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground truncate max-w-[150px]">
                {selectedNode.name}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center">
          {!showConversationHistory && (
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setShowConversationHistory(true)} 
              className="h-6 w-6 text-muted-foreground hover:text-foreground mr-1"
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="icon"
            onClick={startNewConversation} 
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      
      <ScrollArea className="flex-grow w-full" ref={scrollAreaRef}>
        {showConversationHistory ? (
          renderConversationHistory()
        ) : (
          <div className="px-3 py-2 space-y-3">
            {messages.map(renderMessage)}
            {isLoading && renderLoader()}
          </div>
        )}
      </ScrollArea>

      <div className="px-3 py-2 border-t border-border bg-background/95">
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={showConversationHistory ? "Type to start a new conversation..." : "Ask about your notes..."}
            className="flex-grow h-7 text-xs bg-muted/30 border-muted-foreground/20"
          />
          <Button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            size="icon"
            className="h-7 w-7"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatPane;
