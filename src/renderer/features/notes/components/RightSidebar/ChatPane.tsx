import React, { useRef, useEffect, useState } from "react";
import { cn } from "@/renderer/shared/utils";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import { Button } from "@/renderer/shared/components/Button";
import { Input } from "@/renderer/shared/components/Input";
import { Settings, Send } from "lucide-react";
import { toast } from "@/renderer/shared/components/Toast";
import { useNotesContext } from "../../context/notesContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { v4 as uuidv4 } from "uuid";

interface BottomPaneProps {
  onClose: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  id?: string;
  created_at?: string;
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

  const { openNoteById } = useNotesContext();

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
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    
    try {
      // Add the user message to the database
      await window.chatAPI.addMessage(conversationId, userMessage.role, userMessage.content);
      
      // Perform RAG query
      const result = await window.chatAPI.performRAG(conversationId, userMessage.content);
      
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
    }
  };

  const renderMessage = (message: Message, index: number) => (
    <div
      key={message.id || index}
      className={cn(
        "mb-4",
        message.role === "user" ? "text-right" : "text-left"
      )}
    >
      <div
        className={cn(
          "inline-block px-4 py-2 rounded-md",
          message.role === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
        )}
      >
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
                    {...props}
                  >
                    {children}
                  </a>
                );
              }
              return (
                <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                  {children}
                </a>
              );
            },
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );

  const renderLoader = () => (
    <div className="mb-4 text-left">
      <div className="inline-block px-4 py-2 rounded-md bg-secondary text-secondary-foreground">
        <div className="flex space-x-2">
          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
        </div>
      </div>
    </div>
  );

  const startNewConversation = () => {
    const newConversationId = uuidv4();
    setConversationId(newConversationId);
    setMessages([]);
    toast.success("Started a new conversation");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center p-2 border-b border-border">
        <h3 className="text-sm font-medium">Chat</h3>
        <Button variant="ghost" size="sm" onClick={startNewConversation}>
          New Chat
        </Button>
      </div>
      <ScrollArea className="flex-grow px-4" ref={scrollAreaRef}>
        <div className="py-4 space-y-4">
          {messages.map(renderMessage)}
          {isLoading && renderLoader()}
        </div>
      </ScrollArea>
      <div className="border-t border-border p-4">
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
            placeholder="Type your message..."
            className="flex-grow"
          />
          <Button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            size="icon"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatPane;
