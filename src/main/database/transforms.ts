import { FSEntry } from "@/types";
// import { Item } from './types'; // Unused import already handled/commented
import { ItemWithAIMetadata } from './types';

/* 
Idea is to transform the raw database rows 
into a more usable format. It's a flat structure where we 
have each entry ID mapped to an entry object. 

To load in everything, we can just load in the flat structure
and then use the pathToIdMap to load in the children. 

To load parents first, we can use the idToEntryMap. 
*/


export function transformFileSystemData(items: ItemWithAIMetadata[]): Record<string, FSEntry> {
  // Create a map to store the transformed entries
  const entriesMap: Record<string, FSEntry> = {};
  
  // First, create a map of paths to IDs
  const pathToIdMap: Record<string, string> = {};
  items.forEach(item => {
    pathToIdMap[item.path] = item.id;
  });
  
  // Then create all entries with the correct structure
  items.forEach(item => {
    entriesMap[item.id] = {
      id: item.id,
      name: item.name,
      type: item.type as 'folder' | 'file' | 'note',
      path: item.path,
      parentId: item.parent_path ? pathToIdMap[item.parent_path] : null,
      children: [], // Will be populated in the next step
      metadata: {
        createdAt: item.created_at || '',
        updatedAt: item.updated_at || '',
        size: item.size || 0,
      },
      isMounted: item.is_mounted === 1,
      realPath: item.real_path || undefined
    };
  });
  
  // Finally, populate the children arrays
  items.forEach(item => {
    if (item.parent_path && pathToIdMap[item.parent_path]) {
      const parentId = pathToIdMap[item.parent_path];
      if (entriesMap[parentId]) {
        entriesMap[parentId].children.push(item.id);
      }
    }
  });
  
  return entriesMap;
}