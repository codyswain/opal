import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { toast } from "@/renderer/shared/components/Toast";
import { Message, Conversation } from "@/renderer/shared/types";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";

// Placeholder for unused _ variable

export const useChatService = (selectedNodeId: string | null = null) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [, setForceUpdate] = useState(0);
  const forceUpdate = () => setForceUpdate(prev => prev + 1);
  
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
  const [showConversations, setShowConversations] = useState(true);
  const [activeChatView, setActiveChatView] = useState<'conversations' | 'chat'>('conversations');
  
  // Get the selected note info from fileExplorerStore
  const { entities } = useFileExplorerStore();
  const selectedNote = selectedNodeId && entities.notes[selectedNodeId];
  const selectedNode = selectedNodeId && entities.nodes[selectedNodeId];

  const loadConversation = async (id: string) => {
    try {
      // Safeguard against null conversation ID
      if (!id) {
        console.error("Attempted to load conversation with null ID");
        setMessages([
          {
            role: "assistant",
            content: "Hello! What would you like to know about your notes?"
          }
        ]);
        return;
      }
      
      const result = await window.chatAPI.getConversation(id);
      
      if (result.success && Array.isArray(result.messages) && result.messages.length > 0) {
        setMessages(result.messages);
      } else {
        // If no messages found or messages array is empty, set welcome message
        console.log("No messages found for conversation or empty result:", id);
        setMessages([
          {
            role: "assistant",
            content: "Hello! What would you like to know about your notes?"
          }
        ]);
      }
    } catch (error) {
      console.error("Error loading conversation:", error);
      // Ensure messages are set even on error
      setMessages([
        {
          role: "assistant",
          content: "Hello! What would you like to know about your notes?"
        }
      ]);
      toast("Failed to load conversation");
    }
  };

  // Load all conversations
  const loadAllConversations = async () => {
    try {
      const result = await window.chatAPI.getAllConversations();
      
      if (result.success && Array.isArray(result.conversations)) {
        // Filter out any conversations with invalid/missing data
        const validConversations = result.conversations.filter(
          conv => conv && typeof conv === 'object' && conv.id
        );
        
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
      
      // Add explicit error handling for loading conversation
      try {
        loadConversation(conversationId);
      } catch (error) {
        console.error("Error loading conversation on initial mount:", error);
        // If there's an error, set a fallback welcome message
        setMessages([
          {
            role: "assistant",
            content: "Hello! What would you like to know about your notes?"
          }
        ]);
      }
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

  // If the chat history is empty AND we're not in the process of loading, show a welcome message
  useEffect(() => {
    if (messages.length === 0 && !isLoading && !showConversations) {
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

  // Function to start a new conversation
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
    setActiveChatView('chat');
  };

  // Function to switch to a different conversation
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
      setActiveChatView('chat');
      
      // Add additional safety - explicitly load conversation after a short delay
      setTimeout(() => {
        try {
          loadConversation(id);
        } catch (error) {
          console.error("Error loading conversation during explicit load:", error);
          // If there's an error loading, show a fallback message
          setMessages([{
            role: "assistant",
            content: "Chat history could not be loaded. Starting a new conversation."
          }]);
        }
        
        // Remove the switching flag after messages are loaded
        localStorage.removeItem("isSwitchingConversations");
      }, 300);
    } catch (error) {
      console.error("Error switching conversation:", error);
      // Don't show error to user, just reset the state
      setShowConversations(false);
      startNewConversation();
    }
  };

  // Function to handle sending a message
  const handleSend = async () => {
    if (!input.trim()) return;
    
    // Create user message
    const userMessage: Message = { 
      role: "user", 
      content: input.trim(),
      id: uuidv4()
    };
    
    // Add to messages array
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setIsStreaming(true);
    
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
        systemContext += `The user is currently viewing a note titled "${selectedNode.name}" (ID: ${selectedNodeId})`;
        if (selectedNode.path) {
          systemContext += ` located at path: ${selectedNode.path}`;
        }
        systemContext += `. This note was ${metadataStr}. `;
        
        // Create the current note context section that will be clearly highlighted
        currentNoteContext = `
CURRENT NOTE:
============
Title: ${selectedNode.name}
ID: ${selectedNodeId}
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
      
      // Add assistant message
      const messageId = uuidv4();
      const assistantMessage: Message = {
        role: "assistant",
        content: "",
        id: messageId,
        created_at: new Date().toISOString(),
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      
      // Use streaming API to get real-time updates
      let hasReceivedChunks = false;
      
      const cleanupFn = window.chatAPI.performRAGStreaming(chatId, finalQuery, (chunk: string) => {
        // Check for the special completion signal
        if (chunk === "__DONE__") {
          setIsLoading(false);
          setIsStreaming(false);
          return;
        }
        
        // Mark that we've received at least one chunk
        hasReceivedChunks = true;
        
        // Use a callback to get the latest messages state
        setMessages(prevMessages => {
          // Find the last assistant message
          const lastIndex = prevMessages.length - 1;
          
          // Verify we have the assistant message at the end
          if (lastIndex < 0 || prevMessages[lastIndex].role !== "assistant") {
            console.warn("Could not find assistant message to update");
            return prevMessages; // No change
          }
          
          // Update the assistant message with each new chunk
          const updatedMessages = [...prevMessages];
          const lastMessageIndex = updatedMessages.length - 1;
          
          if (lastMessageIndex >= 0 && updatedMessages[lastMessageIndex].role === "assistant") {
            // Ensure the ID is preserved if it exists
            const existingId = updatedMessages[lastMessageIndex].id;
            updatedMessages[lastMessageIndex] = {
              ...updatedMessages[lastMessageIndex],
              content: updatedMessages[lastMessageIndex].content + chunk,
              // Remove __updateKey, React handles updates based on state changes
              // id: existingId || assistantMessage.id // Keep existing or initial ID
            };
          }
          
          // Force a separate UI update via the counter
          setTimeout(() => {
            forceUpdate(); // Force complete component re-render
          }, 0);
          
          // Return the updated messages array
          return updatedMessages;
        });
      });
      
      // Safety timeout in case the streaming never completes
      setTimeout(() => {
        // Only cleanup if we're still in loading/streaming state
        if (isLoading || isStreaming) {
          console.error("Safety timeout fired - cleaning up unfinished streaming");
          
          // Check if we received any chunks
          if (!hasReceivedChunks) {
            console.error("No chunks were received before timeout - this indicates a streaming error");
            
            // Update the message to indicate an error
            setMessages(prevMessages => {
              const lastIndex = prevMessages.length - 1;
              if (lastIndex >= 0 && prevMessages[lastIndex].role === "assistant") {
                const errorMessage = {
                  ...prevMessages[lastIndex],
                  content: "Sorry, there was an error generating a response. Please check your OpenAI API key in settings and try again.",
                };
                const updatedMessages = [...prevMessages];
                updatedMessages[lastIndex] = errorMessage;
                return updatedMessages;
              }
              return prevMessages;
            });
          }
          
          setIsLoading(false);
          setIsStreaming(false);
          cleanupFn(); // Ensure we clean up the event listener
        }
      }, 15000); // 15 seconds timeout

      // Add the assistant's completed message to the database
      const finalAssistantMessage = messages.find(msg => msg.id === assistantMessage.id);
      if (finalAssistantMessage) {
        try {
          await window.chatAPI.addMessage(
            conversationId,
            finalAssistantMessage.role,
            finalAssistantMessage.content,
          );
        } catch (dbError) {
          console.error("Error saving final assistant message:", dbError);
          // Don't necessarily show error to user, maybe log it
        }
      }
    } catch (error) {
      console.error("Error in RAG Chat:", error);
      toast("Failed to get response. Please try again.");
      setIsLoading(false);
      setIsStreaming(false);
    }
  };

  return {
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
  };
}; 