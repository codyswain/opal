import React, { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/renderer/shared/components/Tabs";
import RelatedNotes from "./RelatedNotes";
import ChatPane from "./ChatPane";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const RightSidebar: React.FC<RightSidebarProps> = ({ isOpen }) => {
  const { ui, entities } = useFileExplorerStore();
  const selectedId = ui.selectedId;
  const selectedNode = selectedId ? entities.nodes[selectedId] : null;
  const isNoteSelected = selectedNode?.type === 'note';
  
  // Define default tab based on selection type
  const [defaultTab, setDefaultTab] = useState("related");
  
  // Update default tab when selection changes
  useEffect(() => {
    if (isNoteSelected && ui.rightSidebarTab === "chat") {
      // When a note is selected and chat tab is active, keep it as "chat"
      setDefaultTab("chat");
    } else if (!isNoteSelected && ui.rightSidebarTab === "chat") {
      // When a folder is selected and chat tab is active, set to "chat"
      setDefaultTab("chat");
    } else {
      // Default to "related" for other cases
      setDefaultTab("related");
    }
  }, [isNoteSelected, ui.rightSidebarTab]);

  return (
    <div className="h-full flex flex-col bg-secondary">
      <Tabs defaultValue={defaultTab} value={ui.rightSidebarTab} onValueChange={(value) => useFileExplorerStore.setState(state => ({ ui: { ...state.ui, rightSidebarTab: value } }))} className="flex flex-col h-full">
        <div className="flex justify-between items-center h-8 px-1 border-b border-border bg-background/95">
          <TabsList className="h-full flex gap-2 bg-transparent border-none">
            <TabsTrigger 
              value="related" 
              className="relative h-full px-2 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Related
            </TabsTrigger>
            <TabsTrigger 
              value="chat" 
              className="relative h-full px-2 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Chat
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="related" className="flex-grow overflow-auto p-0 m-0 border-none outline-none data-[state=inactive]:hidden">
          <RelatedNotes isOpen={isOpen} />
        </TabsContent>
        <TabsContent value="chat" className="flex-grow overflow-hidden p-0 m-0 border-none outline-none data-[state=inactive]:hidden">
          <ChatPane isNoteSelected={isNoteSelected} selectedNodeId={selectedId} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default RightSidebar; 