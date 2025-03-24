import React, { useRef, useEffect, useState } from "react";
import { cn } from "@/renderer/shared/utils";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import { Button } from "@/renderer/shared/components/Button";
import { Input } from "@/renderer/shared/components/Input";
import { Send, RefreshCw, Bot, MessageSquare, Plus, History } from "lucide-react";
import { toast } from "@/renderer/shared/components/Toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { v4 as uuidv4 } from "uuid";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";

interface ChatPaneProps {
  onClose: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  id?: string;
  created_at?: string;
}

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  last_message_at: string;
  message_count: number;
}

const ChatPane: React.FC<ChatPaneProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [conversationId, setConversationId] = useState<string>(() => {
    // Generate a new ID and ensure it's stored immediately
    const storedId = localStorage.getItem("currentChatConversationId");
    const newId = storedId || uuidv4();
    if (!storedId) {
      localStorage.setItem("currentChatConversationId", newId);
    }
    return newId;
  });
  const [previousConversations, setPreviousConversations] = useState<Conversation[]>([]);
  const [showConversations, setShowConversations] = useState(false);

  // Get the selected note info from fileExplorerStore
  const { ui, entities } = useFileExplorerStore();
  const selectedId = ui.selectedId;
  const selectedNode = selectedId ? entities.nodes[selectedId] : null;
  const selectedNote = selectedId && selectedNode?.type === 'note' ? entities.notes[selectedId] : null;

  const loadConversation = async (id: string) => {
    try {
      // Safeguard against null conversation ID
      if (!id) {
        return;
      }
      
      const result = await window.chatAPI.getConversation(id);
      if (result.success) {
        setMessages(result.messages);
      } else {
        // If no messages found, set empty message array with welcome message
        setMessages([
          {
            role: "assistant",
            content: "Hello! What would you like to know about your notes?"
          }
        ]);
      }
    } catch (error) {
      console.error("Error loading conversation:", error);
      toast("Failed to load conversation");
    }
  };

  // Load all conversations
  const loadAllConversations = async () => {
    try {
      console.log("Fetching all conversations...");
      const result = await window.chatAPI.getAllConversations();
      console.log("Conversations response:", result);
      
      if (result.success && Array.isArray(result.conversations)) {
        // Filter out any conversations with invalid/missing data
        const validConversations = result.conversations.filter(
          conv => conv && typeof conv === 'object' && conv.id
        );
        
        console.log("Valid conversations:", validConversations);
        
        // If we didn't get any valid conversations, but we did get a response,
        // check if we need to handle a data format issue
        if (validConversations.length === 0 && result.conversations.length > 0) {
          console.warn("Received conversations but none were valid. Data format may be incorrect.");
        }
        
        setPreviousConversations(validConversations);
      } else {
        console.error("Failed to load conversations or invalid data format:", result);
        setPreviousConversations([]);
      }
    } catch (error) {
      console.error("Error loading all conversations:", error);
      setPreviousConversations([]);
    }
  };

  // Load conversation history and previous conversations when component mounts
  useEffect(() => {
    // Immediately load all conversations when component mounts
    loadAllConversations();
    
    // Save conversation ID to localStorage if valid and load the selected conversation
    if (conversationId) {
      localStorage.setItem("currentChatConversationId", conversationId);
      loadConversation(conversationId);
    }
  }, [conversationId]);
  
  // Set up an interval to refresh conversations every 30 seconds
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!showConversations) return; // Only refresh when viewing conversations
      loadAllConversations();
    }, 30000);
    
    return () => clearInterval(intervalId);
  }, [showConversations]);

  useEffect(() => {
    // Scroll to bottom whenever messages change
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current;
      setTimeout(() => {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }, 100);
    }
  }, [messages]);

  // We need to modify the welcome message effect to avoid infinite loops
  useEffect(() => {
    // If the chat history is empty AND we're not in the process of loading, show a welcome message
    if (messages.length === 0 && !isLoading && !showConversations) {
      // Check if we're currently switching between conversations to avoid adding welcome message prematurely
      const isSwitchingConversations = localStorage.getItem("isSwitchingConversations") === "true";
      
      if (!isSwitchingConversations) {
        setMessages([
          {
            role: "assistant",
            content: "Hello! What would you like to know about your notes?"
          }
        ]);
      }
    }
  }, [messages, isLoading, showConversations]);

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
        toast("Note not found or could not be loaded");
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
      // Ensure we have a valid conversation ID
      const chatId = conversationId || uuidv4();
      if (chatId !== conversationId) {
        setConversationId(chatId);
        localStorage.setItem("currentChatConversationId", chatId);
      }
      
      // Add the user message to the database
      await window.chatAPI.addMessage(chatId, userMessage.role, userMessage.content);
      
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
      const result = await window.chatAPI.performRAG(chatId, finalQuery);
      
      if (result.success) {
        // Add the assistant's response to the UI
        const assistantMessage: Message = { 
          role: "assistant", 
          content: result.message.content 
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        toast("Failed to get response" + (result.error ? `: ${result.error}` : ""));
      }
    } catch (error) {
      console.error("Error in RAG Chat:", error);
      toast("Failed to get response. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = (message: Message, index: number) => (
    <div
      key={message.id || index}
      className={cn(
        "mb-2 group",
        message.role === "user" ? "ml-6" : "mr-6"
      )}
    >
      <div className="flex items-start gap-2">
        {message.role === "assistant" && (
          <div className="flex-shrink-0 w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
            <Bot className="w-3 h-3 text-primary" />
          </div>
        )}
        <div className={cn(
          "flex-1 px-3 py-2 rounded-md text-xs",
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
              code: ({ className, children, ...props }: any) => {
                return (
                  <code
                    className={cn(
                      "bg-muted/50 rounded px-1 py-0.5",
                      className
                    )}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              pre: ({ children, ...props }) => (
                <pre
                  className="bg-muted/50 p-3 rounded-md my-2 overflow-x-auto"
                  {...props}
                >
                  {children}
                </pre>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );

  const renderLoader = () => (
    <div className="flex items-center justify-center my-4">
      <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
      <span className="ml-2 text-sm text-muted-foreground">Thinking...</span>
    </div>
  );

  const startNewConversation = () => {
    const newConversationId = uuidv4();
    if (!newConversationId) {
      toast("Error creating new conversation");
      return;
    }
    setConversationId(newConversationId);
    localStorage.setItem("currentChatConversationId", newConversationId);
    setMessages([
      {
        role: "assistant",
        content: "Hello! What would you like to know about your notes?"
      }
    ]);
    setShowConversations(false);
  };

  const switchToConversation = (id: string) => {
    // Don't proceed if ID is falsy, but silently fail instead of showing error
    if (!id || typeof id !== 'string') {
      console.error("Invalid conversation ID provided:", id);
      return;
    }
    
    try {
      // Set a flag to indicate we're switching conversations
      localStorage.setItem("isSwitchingConversations", "true");
      
      // Clear current messages before switching to prevent flicker
      setMessages([]);
      
      // Set the new conversation ID which will trigger the useEffect
      setConversationId(id);
      localStorage.setItem("currentChatConversationId", id);
      setShowConversations(false);
      
      // Remove the switching flag after a short delay
      setTimeout(() => {
        localStorage.removeItem("isSwitchingConversations");
      }, 500);
    } catch (error) {
      console.error("Error switching conversation:", error);
      // Don't show error to user, just reset the state
      setShowConversations(false);
      startNewConversation();
    }
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown date';
    
    try {
      // Try to parse the date string
      const date = new Date(dateString);
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return 'Unknown date';
      }
      
      // For today's date, show time instead
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      if (date.toDateString() === today.toDateString()) {
        return `Today at ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
      } else if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday at ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
      }
      
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return 'Unknown date';
    }
  };

  // Generate a more descriptive title for conversation
  const getConversationTitle = (conversation: Conversation) => {
    if (!conversation) return 'Conversation';
    
    // If we have a title from the user's first message, use it
    if (conversation.title) {
      return conversation.title;
    }
    
    // Fallback to date with message count
    const date = formatDate(conversation.created_at);
    return `Conversation (${date})`;
  };

  // Get a snippet/preview of the last message if available
  const getConversationPreview = (conversation: Conversation) => {
    if (!conversation) return '';
    
    // If we have a title, use it to generate a better preview
    if (conversation.title) {
      return `"${conversation.title}"`;
    }
    
    // Fallback to date information
    return conversation.last_message_at ? 
      `Last activity: ${formatDate(conversation.last_message_at)}` :
      `Created: ${formatDate(conversation.created_at)}`;
  };

  // Sort conversations by most recent first
  const getSortedConversations = () => {
    return [...previousConversations].sort((a, b) => {
      // Safely get timestamps, defaulting to 0 for invalid dates
      const getTimestamp = (dateStr: string | undefined) => {
        if (!dateStr) return 0;
        const date = new Date(dateStr);
        return isNaN(date.getTime()) ? 0 : date.getTime();
      };
      
      const dateA = getTimestamp(a.last_message_at || a.created_at);
      const dateB = getTimestamp(b.last_message_at || b.created_at);
      
      return dateB - dateA;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {showConversations ? (
        <div className="flex flex-col h-full">
          <div className="flex justify-between items-center p-2 border-b border-border">
            <h3 className="text-sm font-medium">Previous Conversations</h3>
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={loadAllConversations}
                className="h-7 w-7"
                title="Refresh conversations"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setShowConversations(false)}
                className="h-7 w-7"
                title="Return to chat"
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-grow">
            <div className="p-2 space-y-2">
              <div className="mb-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full text-xs h-7"
                  onClick={startNewConversation}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  New Conversation
                </Button>
              </div>

              {getSortedConversations().length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-xs text-muted-foreground mb-2">No conversations found</p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="text-xs h-7"
                    onClick={loadAllConversations}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Refresh
                  </Button>
                </div>
              ) : (
                getSortedConversations().map((conversation) => {
                  // Skip rendering if conversation lacks required data
                  if (!conversation || !conversation.id) return null;
                  
                  return (
                    <div 
                      key={conversation.id}
                      className={cn(
                        "p-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors text-xs",
                        conversation.id === conversationId ? "bg-muted border border-border" : ""
                      )}
                      onClick={() => switchToConversation(conversation.id)}
                    >
                      <div className="flex items-start space-x-2">
                        <MessageSquare className="h-3 w-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                        <div className="overflow-hidden flex-1">
                          <h4 className="font-medium truncate">{getConversationTitle(conversation)}</h4>
                          <p className="text-muted-foreground text-[10px] truncate">
                            {getConversationPreview(conversation)}
                            {conversation.message_count > 0 && ` • ${conversation.message_count} messages`}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <>
          <div className="flex justify-between items-center p-2 border-b border-border">
            <div className="flex space-x-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={startNewConversation}
              >
                <Plus className="h-3 w-3 mr-1" />
                New Chat
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => setShowConversations(true)}
              >
                <History className="h-3 w-3 mr-1" />
                History
              </Button>
            </div>
          </div>
          <div className="flex-grow overflow-hidden flex flex-col">
            <ScrollArea className="flex-grow p-2" ref={scrollAreaRef}>
              <div className="space-y-4">
                {messages.map(renderMessage)}
                {isLoading && renderLoader()}
              </div>
            </ScrollArea>
            <div className="p-2 border-t border-border">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center space-x-2"
              >
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask a question about your notes..."
                  className="flex-grow text-xs h-8"
                  disabled={isLoading}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!input.trim() || isLoading}
                  className="h-8 w-8"
                >
                  <Send className="h-3 w-3" />
                </Button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatPane; 