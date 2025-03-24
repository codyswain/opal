import { useCallback, RefObject } from 'react';

export const useScrollToBottom = (
  messagesContainerRef: RefObject<HTMLDivElement>,
  scrollAreaRef: RefObject<HTMLDivElement>
) => {
  // Enhanced scrollToBottom that tries multiple approaches
  const scrollToBottom = useCallback(() => {
    // Try scrolling the messagesContainer directly
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
    
    // Also try scrolling via the Viewport element by ID
    try {
      const viewport = document.getElementById('chat-messages-viewport');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    } catch (e) {
      console.error("Error scrolling viewport:", e);
    }
    
    // And try scrolling the ScrollArea if we have a ref to it
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
    
    // As a last resort, try to find the last message and scroll it into view
    const messages = document.getElementById('chat-messages-container');
    if (messages && messages.lastElementChild) {
      messages.lastElementChild.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [messagesContainerRef, scrollAreaRef]);

  return { scrollToBottom };
}; 