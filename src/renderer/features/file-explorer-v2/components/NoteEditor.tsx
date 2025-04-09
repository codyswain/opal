import React, { useEffect, useCallback, useState } from "react";
import { EditorContent, useEditor, NodeViewWrapper, ReactNodeViewRenderer, NodeViewProps, Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Placeholder } from "@tiptap/extension-placeholder";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { BulletList } from '@tiptap/extension-bullet-list';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { ListItem } from '@tiptap/extension-list-item';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Link } from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { TextAlign } from '@tiptap/extension-text-align';
import { EditorView } from "@tiptap/pm/view";
import { Node } from '@tiptap/core';
import { cn } from '@/renderer/shared/utils/cn';
import './NoteEditor.css';
import { configureLowlight } from "./editorConfig";
import Toolbar from "./Toolbar";
import { EmbeddedItem } from "@/renderer/shared/types";
import { FSEntry } from '@/types';
import { useFileExplorerStore } from "../store/fileExplorerStore";
import { Loader2 } from "lucide-react";
import UnderlineExtension from '@tiptap/extension-underline';
import HighlightExtension from '@tiptap/extension-highlight';

// Custom node view component for embedded items
const EmbedNodeView = (props: NodeViewProps) => {
  const { node } = props;
  const embedId = node.attrs.embedId;
  const embedType = node.attrs.type;
  const [embeddedItem, setEmbeddedItem] = useState<EmbeddedItem | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // This ensures we consider every attribute from the node
  console.log('[EmbedNodeView] Node attrs:', node.attrs);

  // Fetch embedded item data when the component mounts
  useEffect(() => {
    if (!embedId) {
      console.error('[EmbedNodeView] No embedId provided');
      setError('No embed ID provided');
      setIsLoading(false);
      return;
    }

    const fetchEmbeddedItem = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        console.log(`[EmbedNodeView] Fetching embedded item: ${embedId}, type: ${embedType}`);
        const result = await window.fileExplorer.getEmbeddedItem(embedId);
        
        if (result.success && result.embeddedItem) {
          console.log('[EmbedNodeView] Embedded item retrieved:', JSON.stringify(result.embeddedItem, null, 2));
          setEmbeddedItem(result.embeddedItem);
          
          // Get the file path
          const itemPath = result.embeddedItem.item_path;
          
          // Check if it's an image file by matching extension pattern
          const isImageFileByExt = 
            itemPath.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i) !== null;
          
          // Check if it's explicitly marked as an image
          const isExplicitlyImage = embedType === 'image';
          
          // Log all the conditions
          console.log(`[EmbedNodeView] Path check: ${itemPath}`);
          console.log(`[EmbedNodeView] Is image by extension: ${isImageFileByExt}`);
          console.log(`[EmbedNodeView] Is explicitly image type: ${isExplicitlyImage}`);
          console.log(`[EmbedNodeView] Item type from DB: ${result.embeddedItem.item_type}`);
          
          // Determine if we should load image data
          const shouldLoadImage = isImageFileByExt || isExplicitlyImage;
            
          if (shouldLoadImage) {
            console.log('[EmbedNodeView] Should load image, fetching image data for:', itemPath);
            const imagePath = result.embeddedItem.real_path || itemPath;
            console.log('[EmbedNodeView] Using image path:', imagePath);
            
            try {
              const imageResult = await window.fileExplorer.getImageData(imagePath);
              
              console.log('[EmbedNodeView] Image data result:', {
                success: imageResult.success,
                hasDataUrl: !!imageResult.dataUrl,
                error: imageResult.error,
                dataUrlLength: imageResult.dataUrl ? imageResult.dataUrl.length : 0
              });
              
              if (imageResult.success && imageResult.dataUrl) {
                console.log('[EmbedNodeView] Image data loaded successfully, length:', imageResult.dataUrl.length);
                setImageData(imageResult.dataUrl);
              } else {
                console.error('[EmbedNodeView] Failed to load image:', imageResult.error);
                setError(`Failed to load image: ${imageResult.error || 'Unknown error'}`);
              }
            } catch (imageError) {
              console.error('[EmbedNodeView] Error fetching image data:', imageError);
              setError(`Error loading image: ${imageError}`);
            }
          } else {
            console.log('[EmbedNodeView] Not loading image data, item is not recognized as an image');
          }
        } else {
          console.error('[EmbedNodeView] Failed to load embedded item:', result.error);
          setError(`Failed to load embedded item: ${result.error || 'Unknown error'}`);
        }
      } catch (err) {
        console.error('[EmbedNodeView] Error fetching embedded item:', err);
        setError(`Error fetching embedded item: ${err}`);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEmbeddedItem();
  }, [embedId, embedType]);

  // Render based on the embedded item type
  const renderContent = () => {
    try {
      if (isLoading) {
        return (
          <div className="flex items-center justify-center p-4 border border-dashed border-gray-300 rounded-md">
            <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        );
      }

      if (error) {
        return (
          <div className="text-red-500 p-2 border border-red-300 rounded-md">
            Error: {error}
          </div>
        );
      }

      if (!embeddedItem) {
        return (
          <div className="text-gray-400 p-2 border border-gray-300 rounded-md">
            Embedded item not found
          </div>
        );
      }

      console.log('[EmbedNodeView] Rendering embedded item:', {
        type: embeddedItem.item_type,
        name: embeddedItem.item_name,
        path: embeddedItem.item_path,
        embedType,
        hasImageData: !!imageData,
        positionData: embeddedItem.position_in_note
      });

      // Check if it's an image file by matching extension pattern
      const isImageFile = 
        embeddedItem.item_path.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i) !== null;
        
      // Check if we should render as image based on embedType or file extension
      const shouldRenderAsImage = 
        embedType === 'image' || 
        (embeddedItem.item_type === 'file' && isImageFile);
        
      console.log(`[EmbedNodeView] Should render as image: ${shouldRenderAsImage}, has image data: ${!!imageData}`);

      // Render an image if we have a file with image extension and loaded image data
      if (shouldRenderAsImage && imageData) {
        console.log('[EmbedNodeView] Rendering image with data URL length:', imageData.length);
        return (
          <div className="embedded-image-container">
            <img 
              src={imageData} 
              alt={embeddedItem.item_name}
              className="max-w-full rounded-md shadow-sm"
              style={{
                maxHeight: (embeddedItem.position_in_note.maxHeight as string | number) || '400px',
                width: 'auto',
                display: 'block',
                margin: '0 auto'
              }}
              onError={(e) => console.error('[EmbedNodeView] Image failed to load in <img> tag:', e)}
            />
            <div className="text-xs text-gray-500 mt-1 text-center">
              {embeddedItem.item_name}
            </div>
          </div>
        );
      } 
      
      // Fallback for images that failed to load
      if (shouldRenderAsImage && !imageData) {
        console.log('[EmbedNodeView] Image failed to load, displaying fallback');
        return (
          <div className="p-2 border border-gray-300 rounded-md">
            Image: {embeddedItem.item_name} (failed to load)
          </div>
        );
      }

      // Render a folder preview
      if (embeddedItem.item_type === 'folder') {
        return (
          <div className="p-3 border border-gray-300 rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
            <div className="flex items-center mb-2">
              <svg className="w-5 h-5 text-yellow-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="font-medium">{embeddedItem.item_name}</span>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Folder content preview will be rendered here
            </div>
          </div>
        );
      }

      // Render a regular file preview (non-image)
      if (embeddedItem.item_type === 'file') {
        return (
          <div className="p-3 border border-gray-300 rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
            <div className="flex items-center mb-2">
              <svg className="w-5 h-5 text-blue-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="font-medium">{embeddedItem.item_name}</span>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              File content preview will be rendered here
            </div>
          </div>
        );
      }

      // Render a note preview
      if (embeddedItem.item_type === 'note') {
        return (
          <div className="p-3 border border-gray-300 rounded-md bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
            <div className="flex items-center mb-2">
              <svg className="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span className="font-medium">{embeddedItem.item_name}</span>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Note content preview will be rendered here
            </div>
          </div>
        );
      }

      // Default fallback
      return (
        <div className="p-2 border border-gray-300 rounded-md">
          Unknown item type: {embeddedItem.item_type} - {embeddedItem.item_name}
        </div>
      );
    } catch (renderError) {
      console.error('[EmbedNodeView] Error rendering content:', renderError);
      return (
        <div className="text-red-500 p-2 border border-red-300 rounded-md">
          Error rendering content: {String(renderError)}
        </div>
      );
    }
  };

  return (
    <NodeViewWrapper className="embed-node-wrapper my-4">
      {renderContent()}
    </NodeViewWrapper>
  );
};

// EmbedNode extension to handle custom embeds
const EmbedNode = Node.create({
  name: 'embedNode',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  inline: false,
  
  addAttributes() {
    return {
      embedId: {
        default: null as string | null,
      },
      type: {
        default: 'unknown' as string,
      },
      htmlContent: {
        default: '' as string,
      },
    };
  },
  
  parseHTML() {
    return [
      {
        tag: 'div[data-embed-id]',
      },
    ];
  },
  
  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, string> }) {
    return ['div', { 
      class: 'embedded-item', 
      'data-embed-id': HTMLAttributes.embedId,
      'data-embed-type': HTMLAttributes.type,
    }, HTMLAttributes.htmlContent];
  },

  // Use the ReactNodeViewRenderer for custom rendering
  addNodeView() {
    return ReactNodeViewRenderer(EmbedNodeView);
  },
});

// Enhanced FileHandler component to handle dropped files/folders
const FileHandler = ({ 
  children, 
  onFileDrop, 
  onItemDrop, 
  noteId,
  entities 
}: { 
  children: React.ReactNode, 
  onFileDrop: (files: File[]) => void,
  onItemDrop: (item: FSEntry, clientX: number, clientY: number, noteId: string) => void,
  noteId: string,
  entities: { nodes: Record<string, FSEntry> }
}) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsDraggingOver(false);
    
    // Log all data types available
    console.log('Drop event data types:', Array.from(e.dataTransfer.types));
    
    // First check and log all custom data
    if (e.dataTransfer.types.includes('application/opal-item-id')) {
      const itemId = e.dataTransfer.getData('application/opal-item-id');
      const itemType = e.dataTransfer.getData('application/opal-item-type');
      const itemName = e.dataTransfer.getData('application/opal-item-name');
      
      console.log('Dropped item details:', { itemId, itemType, itemName });
      
      // Find the item in the store
      if (itemId && entities.nodes[itemId]) {
        const item = entities.nodes[itemId];
        console.log('Found item in store:', item);
        onItemDrop(item, e.clientX, e.clientY, noteId);
        return;
      } else if (itemId) {
        console.error('Item ID found but not in store:', itemId);
      }
    }
    
    // Check for native file drops (as fallback)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      console.log('Dropped files:', files.map(f => f.name));
      onFileDrop(files);
      return;
    }
    
    console.log('No valid item or files found in drop event');
  }, [entities.nodes, onFileDrop, onItemDrop, noteId]);
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    
    // Check if the drag has files or a known item
    const hasFiles = e.dataTransfer.types.includes('Files');
    const hasItemId = e.dataTransfer.types.includes('application/opal-item-id');
    
    if (hasFiles || hasItemId) {
      e.dataTransfer.dropEffect = 'copy';
      // Only set dragging state if it's a valid drag
      setIsDraggingOver(true);
    }
  }, []);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only reset if we're leaving the main container
    // This prevents flicker when moving between child elements
    if (e.currentTarget === e.target) {
      setIsDraggingOver(false);
    }
  }, []);
  
  return (
    <div 
      className={`w-full h-full ${isDraggingOver ? 'tiptap-drag-active' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={() => setIsDraggingOver(true)}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
};

const lowlight = configureLowlight();

const USE_TABS = true; 
const SPACES_PER_TAB = 4;

interface NoteEditorProps {
  content: string;
  onUpdate: ({ editor, wordCount }: { editor: Editor, wordCount?: { words: number, characters: number } }) => void;
  readOnly?: boolean;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ 
  content, 
  onUpdate,
  readOnly = false,
}) => {
  // Move the store to the component level so it can be used in callbacks
  const { entities } = useFileExplorerStore();
  
  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        paragraph: {
          HTMLAttributes: {
            class: 'paragraph',
          },
        },
        history: {
          depth: 100,
          newGroupDelay: 500,
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
        HTMLAttributes: {
          class: 'code-block',
        },
      }),
      UnderlineExtension,
      HighlightExtension,
      Markdown.configure({
        transformPastedText: true,
      }),
      Placeholder.configure({
        placeholder: "Type '/' for commands...",
        emptyEditorClass: 'is-editor-empty',
      }),
      BulletList.configure({
        keepMarks: true,
        keepAttributes: false,
        HTMLAttributes: {
          class: 'bullet-list',
        },
      }),
      OrderedList.configure({
        keepMarks: true,
        keepAttributes: false,
        itemTypeName: 'listItem',
        HTMLAttributes: {
          class: 'ordered-list',
        },
      }),
      ListItem.configure({
        HTMLAttributes: {
          class: 'list-item',
        },
      }),
      TaskList.configure({
        HTMLAttributes: {
          class: 'task-list',
        },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class: 'task-item',
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'editor-table',
        },
      }),
      TableRow,
      TableHeader,
      TableCell,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'editor-link',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
        validate: url => /^https?:\/\//.test(url) || url.startsWith('#'),
      }),
      Image.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: 'editor-image',
        },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: 'left',
      }),
      // Add our embed extension
      EmbedNode,
    ],
    content: content || "",
    onUpdate: ({ editor }) => {
      // Update word count
      const text = editor.getText();
      const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
      const characterCount = text.length;
      
      const newWordCount = {
        words: wordCount,
        characters: characterCount,
      };
      
      // Pass the word count to the parent component
      onUpdate({ editor, wordCount: newWordCount });
    },
    autofocus: !readOnly,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-md dark:prose-invert focus:outline-none max-w-none h-full w-full overflow-auto cursor-text",
          readOnly && "editor-readonly"
        ),
        spellcheck: "false",
      },
      handleDOMEvents: {
        scroll: (view, event) => {
          const element = event.target as HTMLElement;
          element.style.scrollBehavior = 'smooth';
          return false;
        },
      },
      handleKeyDown: (view: EditorView, event: KeyboardEvent): boolean => {
        if (readOnly) return false;
        
        // Handle paragraph spacing for consistency
        if (event.key === 'Enter' && !event.shiftKey) {
          // Default paragraph behavior is fine - CSS handles spacing now
        }
        
        if (event.key === 'Tab') {
          event.preventDefault();
          if (event.shiftKey) {
            // Outdent (move left) when Shift+Tab is pressed
            if (editor?.commands.liftListItem('listItem')) {
              return true;
            }
            return false;
          } else {
            // Indent (move right) when Tab is pressed
            if (editor?.commands.sinkListItem('listItem')) {
              return true;
            }
            // If not in a list, add indentation
            const { from } = editor.state.selection;
            const indentation = USE_TABS ? '\t' : ' '.repeat(SPACES_PER_TAB);
            editor.chain()
              .focus()
              .insertContent({ type: 'text', text: indentation })
              .setTextSelection(from + indentation.length)
              .run();
            return true;
          }
        }
        
        // Handle keyboard shortcuts
        if (event.key === 'b' && (event.ctrlKey || event.metaKey)) {
          editor.chain().focus().toggleBold().run();
          return true;
        }
        
        if (event.key === 'i' && (event.ctrlKey || event.metaKey)) {
          editor.chain().focus().toggleItalic().run();
          return true;
        }
        
        return false;
      },
      handleDrop: (view, event, slice, moved) => {
        // Handle dropped content and files
        if (!moved && event.dataTransfer?.files.length) {
          const files = Array.from(event.dataTransfer.files);
          const imageFiles = files.filter(file => file.type.startsWith('image/'));
          
          if (imageFiles.length > 0) {
            // Show image upload modal or handle image insert directly
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
    },
  });

  // Update editor content when it changes externally
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content, editor]);
  
  // Handle file drop for image upload
  const handleFileDrop = useCallback((files: File[]) => {
    if (!editor) return;
    
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    imageFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          editor.chain().focus().setImage({ src: result }).run();
        }
      };
      reader.readAsDataURL(file);
    });
  }, [editor]);
  
  // Handle item drop from the file explorer
  const handleItemDrop = useCallback(async (item: FSEntry, clientX: number, clientY: number, noteId: string) => {
    if (!editor) return;
    
    try {
      console.log('Item drop details:', {
        id: item.id,
        name: item.name,
        type: item.type,
        path: item.path,
        parentId: item.parentId
      });
      
      if (item.parentId) {
        const parentNode = entities.nodes[item.parentId];
        console.log('Parent node:', parentNode ? {
          id: parentNode.id,
          name: parentNode.name,
          type: parentNode.type
        } : 'No parent found');
      }
      
      // Get the current editor view
      const view = editor.view;
      const editorElement = view.dom;
      const editorRect = editorElement.getBoundingClientRect();
      
      // Calculate relative positions within the editor
      const relX = clientX - editorRect.left;
      const relY = clientY - editorRect.top;
      
      // Get the position in the document close to the drop
      const posAtCoords = view.posAtCoords({ left: clientX, top: clientY });
      
      if (!posAtCoords) {
        console.error('Could not find drop position in document');
        return;
      }
      
      // Check if it's an image file by matching extension pattern
      const isImageFile = item.type === 'file' && 
        item.path.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i) !== null;
      
      // Prepare position data with additional properties based on item type
      const positionData = {
        type: item.type,
        isImage: isImageFile,
        x: relX,
        y: relY,
        itemName: item.name,
        itemPath: item.path
      };
      
      // Add additional properties for images
      if (isImageFile) {
        Object.assign(positionData, {
          maxHeight: 400, // Default max height for images
          displayMode: 'inline', // Default display mode
        });
      }
      
      console.log('Creating embedded item with position data:', positionData);
      
      // Create the embedded item in the database
      const result = await window.fileExplorer.createEmbeddedItem(noteId, item.id, positionData);
      
      if (!result.success || !result.embeddedId) {
        console.error('Failed to create embedded item:', result.error);
        return;
      }
      
      console.log('Embedded item created with ID:', result.embeddedId);
      
      // Determine the correct type to use
      let embedType: string = item.type;
      if (isImageFile) {
        embedType = 'image';
      }
      
      console.log(`Inserting embed node with type: ${embedType} and ID: ${result.embeddedId}`);
      
      // Insert the embed node at the drop position
      editor.chain()
        .focus()
        .setTextSelection(posAtCoords.pos)
        .insertContent({
          type: 'embedNode',
          attrs: { 
            embedId: result.embeddedId,
            type: embedType
          }
        })
        .run();
      
    } catch (error) {
      console.error('Error embedding item in note:', error);
    }
  }, [editor, entities]);

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="sticky top-0 z-10 backdrop-blur-sm bg-background/80 border-b border-border/30">
        <div className="max-w-[900px] mx-auto w-full px-6 py-1 sm:px-4 xs:px-3">
          {!readOnly && (
            <Toolbar editor={editor} />
          )}
        </div>
      </div>
      
      <div className="flex-grow overflow-auto relative w-full">
        <FileHandler 
          onFileDrop={handleFileDrop} 
          onItemDrop={handleItemDrop} 
          noteId={''}
          entities={entities}
        >
          <div className="h-full w-full">
            <EditorContent 
              className="h-full w-full" 
              editor={editor} 
            />
          </div>
        </FileHandler>
      </div>
    </div>
  );
};

export default NoteEditor;