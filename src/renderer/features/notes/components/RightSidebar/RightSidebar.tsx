import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/renderer/shared/components/Tabs";
import RelatedNotes from "./RelatedNotes";
import ChatPane from "./ChatPane";

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const RightSidebar: React.FC<RightSidebarProps> = ({ isOpen, onClose }) => {
  return (
    <div className="h-full flex flex-col bg-background">
      <Tabs defaultValue="related" className="flex flex-col h-full">
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
        </div>
        <TabsContent value="related" className="flex-grow overflow-hidden p-0 m-0 border-none outline-none data-[state=inactive]:hidden">
          <RelatedNotes isOpen={isOpen} onClose={onClose} />
        </TabsContent>
        <TabsContent value="chat" className="flex-grow overflow-hidden p-0 m-0 border-none outline-none data-[state=inactive]:hidden">
          <ChatPane onClose={onClose} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default RightSidebar;
