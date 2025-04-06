import React, { useState } from 'react';
import { cn } from "@/renderer/shared/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/renderer/shared/components/Tabs";
import RelatedNotes from "./RelatedNotes";
import ChatPane from "./ChatPane";
import { Button } from "@/renderer/shared/components/Button";
import { Plus } from "lucide-react";

interface RightSidebarProps {
  className?: string;
  isOpen: boolean;
  onClose: () => void;
}

const RightSidebar: React.FC<RightSidebarProps> = ({ 
  // className, // Unused prop
  isOpen, 
  // onClose // Unused prop
}) => {
  // const selectedId = useFileExplorerStore(state => state.ui.selectedId); // Unused variable
  // const notes = useFileExplorerStore(state => state.entities.notes); // Unused variable
  const [activeTab, setActiveTab] = useState("related");
  const [chatKey, setChatKey] = useState(0);

  const handleNewChat = () => {
    setChatKey(prev => prev + 1);
    setActiveTab("chat");
  };

  return (
    <div
      className={cn(
        "h-full flex flex-col border-l border-border bg-card text-card-foreground",
        !isOpen && "hidden"
      )}
    >
      <div className="flex items-center justify-between p-2 border-b border-border">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-grow">
          <TabsList className="grid grid-cols-2 w-[180px]">
            <TabsTrigger value="related">Related</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
          </TabsList>
        </Tabs>
        {activeTab === "chat" && (
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleNewChat}
            className="h-7 w-7 ml-2"
            title="New Chat"
          >
            <Plus className="w-4 h-4" />
          </Button>
        )}
      </div>
      
      <div className="flex-grow overflow-hidden">
        <TabsContent value="related" className="h-full mt-0 border-0 p-0">
          <RelatedNotes 
            isOpen={activeTab === "related"} 
          />
        </TabsContent>
        <TabsContent value="chat" className="h-full mt-0 border-0 p-0">
          <ChatPane 
            key={chatKey} 
          />
        </TabsContent>
      </div>
    </div>
  );
};

export default RightSidebar;
