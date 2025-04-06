import React, { useRef, useEffect } from "react";
import { cn } from "@/renderer/shared/utils";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { Bot, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Message } from "../ChatPane";
import { useScrollToBottom } from "./useScrollToBottom";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({ 
  messages, 
  isLoading, 
  isStreaming 
}) => {
  const messageRefs = useRef<{[key: string]: HTMLDivElement | null}>({});
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { scrollToBottom } = useScrollToBottom(messagesContainerRef, scrollAreaRef);

  // Use a MutationObserver to detect when new content is added
  useEffect(() => {
    const messagesContainer = document.getElementById('chat-messages-container');
    if (!messagesContainer) return;
    
    const observer = new MutationObserver(scrollToBottom);
    
    observer.observe(messagesContainer, { 
      childList: true,
      subtree: true,
      characterData: true
    });
    
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // Add useEffect to scroll when messages change or streaming occurs
  useEffect(() => {
    setTimeout(scrollToBottom, 0);
    setTimeout(scrollToBottom, 100);
    setTimeout(scrollToBottom, 300);
  }, [messages, isStreaming, scrollToBottom]);
  
  // After streaming is complete, make a final scroll
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      setTimeout(scrollToBottom, 100);
    }
  }, [isStreaming, messages.length, scrollToBottom]);

  // Function to open a note by ID
  const openNoteById = async (noteId: string) => {
    const { entities, selectEntry, getNote } = useFileExplorerStore.getState();
    
    if (entities.nodes[noteId]) {
      await selectEntry(noteId);
    } else {
      try {
        await getNote(noteId);
        await selectEntry(noteId);
      } catch (error) {
        console.error("Failed to open note:", error);
      }
    }
  };

  const renderMessage = (message: Message, index: number) => {
    const renderKey = message.id || message.__updateKey || `message-${index}`;
    
    return (
      <div
        key={renderKey}
        id={`message-${index}`}
        ref={el => messageRefs.current[message.id || `message-${index}`] = el}
        className={cn(
          "mb-2 group",
          message.role === "user" ? "ml-6" : "mr-6"
        )}
        data-message-role={message.role}
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
            {message.content ? (
              <ReactMarkdown
                key={`markdown-${renderKey}`}
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
                  code: ({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) => (
                    <code
                      className={cn(
                        "bg-muted/50 rounded px-1 py-0.5",
                        className
                      )}
                      {...props}
                    >
                      {children}
                    </code>
                  ),
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
            ) : (
              <div className="min-h-[16px]"></div>
            )}
            {index === messages.length - 1 && message.role === "assistant" && isStreaming && (
              <div className="typing-indicator mt-1">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderLoader = () => (
    <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-md my-3 animate-pulse">
      <div className="flex-shrink-0 w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
        <Loader2 className="w-3 h-3 text-primary animate-spin" />
      </div>
      <div className="flex-1">
        <div className="h-2 bg-muted-foreground/20 rounded w-3/4 mb-2"></div>
        <div className="h-2 bg-muted-foreground/15 rounded w-1/2"></div>
      </div>
    </div>
  );

  return (
    <div className="flex-grow overflow-hidden flex flex-col">
      <ScrollArea 
        className="flex-grow p-2" 
        scrollHideDelay={0}
        ref={scrollAreaRef}
      >
        <ScrollAreaPrimitive.Viewport 
          className="h-full w-full rounded-[inherit]"
          id="chat-messages-viewport"
          ref={messagesContainerRef}
        >
          <div 
            className="space-y-4 flex flex-col" 
            id="chat-messages-container"
          >
            {messages.map(renderMessage)}
            {isLoading && !isStreaming && renderLoader()}
          </div>
        </ScrollAreaPrimitive.Viewport>
      </ScrollArea>
      <style>
        {`
          .typing-indicator {
            display: inline-flex;
            align-items: center;
            margin-top: 4px;
          }
          .typing-indicator .dot {
            background-color: currentColor;
            border-radius: 50%;
            width: 4px;
            height: 4px;
            margin: 0 1px;
            opacity: 0.7;
            animation: typing 1.4s infinite ease-in-out;
          }
          .typing-indicator .dot:nth-child(1) {
            animation-delay: 0s;
          }
          .typing-indicator .dot:nth-child(2) {
            animation-delay: 0.2s;
          }
          .typing-indicator .dot:nth-child(3) {
            animation-delay: 0.4s;
          }
          @keyframes typing {
            0%, 60%, 100% {
              transform: translateY(0);
            }
            30% {
              transform: translateY(-4px);
            }
          }
        `}
      </style>
    </div>
  );
}; 