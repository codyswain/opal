import { FSEntry } from "@/types";
import { Item, ItemWithAIMetadata } from "./types";

/* 
Idea is to transform the raw database rows 
into a more usable format. It's a flat structure where we 
have each entry ID mapped to an entry object. 

To load in everything, we can just load in the flat structure
and then use the pathToIdMap to load in the children. 

To load parents first, we can use the idToEntryMap. 
*/



export function transformFileSystemData(items: ItemWithAIMetadata[]): Record<string, FSEntry> {
  const entries: FSEntry[] = [];
  
  // first pass: create a path to id map 
  const pathToIdMap: Record<string, string> = {};
  items.forEach((item) => {
    pathToIdMap[item.path] = item.id;
  });

  // second pass: create an id to entry map
  const idToEntryMap: Record<string, FSEntry> = {};
  items.forEach(item => {
    const entry: FSEntry = {
      id: item.id,
      name: item.name,
      path: item.path,
      type: item.type,
      parentId: item.parent_path ? pathToIdMap[item.parent_path] : null,
      children: [],
      metadata: {
        size: item.size,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
    }

    idToEntryMap[item.id] = entry;
    entries.push(entry);
  })
  
  // third pass: append children ids to parent
  entries.forEach(entry => {
    if (entry.parentId) {
      idToEntryMap[entry.parentId].children.push(entry.id);
    }
  })

  return idToEntryMap;
}