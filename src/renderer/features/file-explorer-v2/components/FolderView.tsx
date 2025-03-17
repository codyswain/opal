import { FSEntry } from "@/types";
import React from "react";

interface FolderViewProps {
  selectedNode: FSEntry;
  entities: {
    nodes: Record<string, FSEntry>
  };
  selectEntry: (id: string) => void;
}

const FolderView: React.FC<FolderViewProps> = ({ 
  selectedNode, 
  entities, 
  selectEntry 
}) => {
  return (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-4">{selectedNode?.name}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {selectedNode?.children.map((childId) => (
          <div 
            key={childId} 
            className="p-3 bg-card hover:bg-card/80 rounded-lg cursor-pointer"
            onClick={() => selectEntry(childId)}
          >
            {entities.nodes[childId]?.name}
          </div>
        ))}
      </div>
    </div>
  );
};

export default FolderView;