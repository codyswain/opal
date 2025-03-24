import React from "react";
import { Button } from "@/renderer/shared/components/Button";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import { MessageSquare, RefreshCw, Plus } from "lucide-react";
import { cn } from "@/renderer/shared/utils";
import { Conversation } from "../ChatPane";

interface ConversationsListProps {
  conversations: Conversation[];
  switchToConversation: (id: string) => void;
  startNewConversation: () => void;
}

export const ConversationsList: React.FC<ConversationsListProps> = ({
  conversations,
  switchToConversation,
  startNewConversation
}) => {
  // Format date for display
  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown date';
    
    try {
      const date = new Date(dateString);
      
      if (isNaN(date.getTime())) {
        return 'Unknown date';
      }
      
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
    
    if (conversation.title) {
      return conversation.title;
    }
    
    const date = formatDate(conversation.created_at);
    return `Conversation (${date})`;
  };

  // Get a snippet/preview of the last message if available
  const getConversationPreview = (conversation: Conversation) => {
    if (!conversation) return '';
    
    if (conversation.title) {
      return `"${conversation.title}"`;
    }
    
    return conversation.last_message_at ? 
      `Last activity: ${formatDate(conversation.last_message_at)}` :
      `Created: ${formatDate(conversation.created_at)}`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center p-2 border-b border-border">
        <h3 className="text-sm font-medium">Conversations</h3>
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7"
            title="Refresh conversations"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={startNewConversation}
            className="h-7 w-7"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-grow">
        <div className="p-2 space-y-2">
          {conversations.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-muted-foreground mb-2">No conversations found</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="text-xs h-7"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Refresh
              </Button>
            </div>
          ) : (
            conversations.map((conversation) => {
              // Skip rendering if conversation lacks required data
              if (!conversation || !conversation.id) return null;
              
              return (
                <div 
                  key={conversation.id}
                  className={cn(
                    "p-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors text-xs"
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
  );
}; 