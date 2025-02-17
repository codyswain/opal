import { ScrollArea } from "@radix-ui/react-scroll-area";
import { Input } from "@/renderer/shared/components/Input";
import { useCallback, useState } from "react";
import log from 'electron-log';

const API_URL = "http://localhost:11434/api/chat";

const createPayload = (question: string) => {
  return JSON.stringify({
    model: "llama3",
    messages: [{ role: "user", content: question }],
  });
};

export default function ChatLocalPane() {
  const [input, setInput] = useState<string>("");
  const [messages, setMessage] = useState<string>("");

  const handleSend = useCallback(async () => {
    log.info('Sending message to API');

    const response: Response = await fetch(API_URL, {
      method: "POST",
      body: createPayload(input),
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let chunk = await reader.read();
    while (!chunk.done) {
      const chunkStr = decoder.decode(chunk.value);
      const lines = chunkStr.split("\n");
      for (const line of lines){
        if (line.length <= 0){
          continue;
        }
        try {
          const lineJson = JSON.parse(line.trim());
          const message = lineJson.message.content;
          setMessage(prev => prev+message);
          if (lineJson.done){
            log.info('Received complete response from API');
            break;
          }
        } catch (e){
          log.error('Error parsing chunk', e);
        }
      }
      chunk = await reader.read();
    }
  }, [input]);

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex flex-grow px-4">
        <div className="py-4 space-y-4">Messages: {messages}</div>
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
        </div>
      </div>
    </div>
  );
}
