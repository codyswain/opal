import React from "react";
import { Button } from "@/renderer/shared/components/Button";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import { MessageSquare, RefreshCw, Plus } from "lucide-react";
import { cn } from "@/renderer/shared/utils";
import { Conversation } from '@/renderer/shared/types';

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
    
    // Use latest_user_message as title if available, fallback to date
    if (conversation.latest_user_message) {
      return conversation.latest_user_message;
    }
    
    const date = formatDate(conversation.last_updated); // Use last_updated
    return `Conversation (${date})`;
  };

  // Get a snippet/preview of the last message if available
  const getConversationPreview = (conversation: Conversation) => {
    if (!conversation) return '';
    
    // Display last updated time
    return conversation.last_updated ? 
      `Last updated: ${formatDate(conversation.last_updated)}` :
      'No activity recorded'; // Fallback if last_updated is missing
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
              if (!conversation || !conversation.conversation_id) return null; // Use conversation_id
              
              return (
                <div 
                  key={conversation.conversation_id} // Use conversation_id
                  className={cn(
                    "p-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors text-xs"
                  )}
                  onClick={() => switchToConversation(conversation.conversation_id)} // Use conversation_id
                >
                  <div className="flex items-start space-x-2">
                    <MessageSquare className="h-3 w-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div className="overflow-hidden flex-1">
                      <h4 className="font-medium truncate">{getConversationTitle(conversation)}</h4>
                      <p className="text-muted-foreground text-[10px] truncate">
                        {getConversationPreview(conversation)}
                        {/* message_count already exists and is used correctly */}
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