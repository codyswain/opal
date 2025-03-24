import React, { useRef, useEffect, useState } from "react";
import { cn } from "@/renderer/shared/utils";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import { Button } from "@/renderer/shared/components/Button";
import { Input } from "@/renderer/shared/components/Input";
import { Send, RefreshCw, Bot } from "lucide-react";
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

const ChatPane: React.FC<ChatPaneProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [conversationId, setConversationId] = useState<string>(() => {
    // Use an existing conversation ID from localStorage or create a new one
    return localStorage.getItem("currentChatConversationId") || uuidv4();
  });

  // Get the selected note info from fileExplorerStore
  const { ui, entities } = useFileExplorerStore();
  const selectedId = ui.selectedId;
  const selectedNode = selectedId ? entities.nodes[selectedId] : null;
  const selectedNote = selectedId && selectedNode?.type === 'note' ? entities.notes[selectedId] : null;

  // Load conversation history when component mounts
  useEffect(() => {
    const loadConversation = async () => {
      try {
        const result = await window.chatAPI.getConversation(conversationId);
        if (result.success) {
          setMessages(result.messages);
        }
      } catch (error) {
        console.error("Error loading conversation:", error);
      }
    };

    // Save conversation ID to localStorage
    localStorage.setItem("currentChatConversationId", conversationId);
    
    loadConversation();
  }, [conversationId]);

  useEffect(() => {
    // Scroll to bottom whenever messages change
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current;
      setTimeout(() => {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }, 100);
    }
  }, [messages]);

  // If the chat history is empty, show a welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          role: "assistant",
          content: "Hello! What would you like to know about your notes?"
        }
      ]);
    }
  }, [messages]);

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
    // Generate a new UUID for the conversation
    const newConversationId = uuidv4();
    setConversationId(newConversationId);
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden" ref={scrollAreaRef}>
        <ScrollArea className="h-full px-1 py-2">
          <div className="space-y-2">
            {messages.map(renderMessage)}
            {isLoading && renderLoader()}
          </div>
        </ScrollArea>
      </div>
      <div className="p-1 border-t border-border">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-1">
          <Input
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 h-8 text-xs"
          />
          <Button type="submit" size="icon" className="h-8 w-8" disabled={isLoading || !input.trim()}>
            <Send className="h-3 w-3" />
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ChatPane; 