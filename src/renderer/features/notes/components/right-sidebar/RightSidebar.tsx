import React from "react";
import { cn } from "@/renderer/shared/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/renderer/shared/components/Tabs";
import { Note, SimilarNote } from "@/renderer/shared/types";
import { ScrollArea } from "@/renderer/shared/components/ScrollArea";
import ChatPane from "./ChatPane";
import RelatedNotes from "./RelatedNotes";
import { useNotesContext } from "../../context/notesContext";
import { useState } from "react";
import { Button } from "@/renderer/shared/components/Button";
import { Plus } from "lucide-react";

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const RightSidebar: React.FC<RightSidebarProps> = ({ isOpen, onClose }) => {
  const { findSimilarNotes } = useNotesContext();
  const [chatKey, setChatKey] = React.useState(0);
  const [activeTab, setActiveTab] = React.useState("related");
  const [similarNotes, setSimilarNotes] = useState<SimilarNote[]>([]);
  const [similarNotesIsLoading, setSimilarNotesIsLoading] = useState<boolean>(false);
  
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
          <RelatedNotes isOpen={activeTab === "related"} onClose={onClose} />
        </TabsContent>
        <TabsContent value="chat" className="h-full mt-0 border-0 p-0">
          <ChatPane key={chatKey} onClose={onClose} />
        </TabsContent>
      </div>
    </div>
  );
};

export default RightSidebar;
