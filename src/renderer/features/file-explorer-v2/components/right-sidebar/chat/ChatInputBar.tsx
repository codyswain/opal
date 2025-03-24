import React from "react";
import { Button } from "@/renderer/shared/components/Button";
import { Input } from "@/renderer/shared/components/Input";
import { Send } from "lucide-react";

interface ChatInputBarProps {
  input: string;
  setInput: (input: string) => void;
  handleSend: () => void;
  isLoading: boolean;
}

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  input,
  setInput,
  handleSend,
  isLoading
}) => {
  return (
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
  );
}; 