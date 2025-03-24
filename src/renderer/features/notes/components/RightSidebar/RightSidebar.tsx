import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/renderer/shared/components/Tabs";
import RelatedNotes from "./RelatedNotes";
import ChatPane from "./ChatPane";
import { Button } from "@/renderer/shared/components/Button";
import { Plus } from "lucide-react";

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const RightSidebar: React.FC<RightSidebarProps> = ({ isOpen, onClose }) => {
  const [chatKey, setChatKey] = React.useState(0);
  const [activeTab, setActiveTab] = React.useState("related");
  
  const handleNewChat = () => {
    setChatKey(prev => prev + 1);
    setActiveTab("chat");
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <Tabs 
        defaultValue="related" 
        className="flex flex-col h-full"
        onValueChange={setActiveTab}
        value={activeTab}
      >
        <div className="flex justify-between items-center h-8 px-3 border-b border-border bg-background/95">
          <TabsList className="h-full flex gap-4 bg-transparent border-none">
            <TabsTrigger 
              value="related" 
              className="relative h-full px-0 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Related
            </TabsTrigger>
            <TabsTrigger 
              value="chat" 
              className="relative h-full px-0 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Chat
            </TabsTrigger>
          </TabsList>
          <div>
            HELLO
          </div>
          <Button 
            variant="ghost" 
            size="sm"
            className={`h-6 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ${activeTab !== "chat" ? "invisible" : ""}`}
            onClick={handleNewChat}
          >
            <Plus className="h-3.5 w-3.5" />
            New Chat
          </Button>
        </div>
        <TabsContent value="related" className="flex-grow overflow-hidden p-0 m-0 border-none outline-none data-[state=inactive]:hidden">
          <RelatedNotes isOpen={isOpen} onClose={onClose} />
        </TabsContent>
        <TabsContent value="chat" className="flex-grow overflow-hidden p-0 m-0 border-none outline-none data-[state=inactive]:hidden">
          <ChatPane key={chatKey} onClose={onClose} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default RightSidebar;
