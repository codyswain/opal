import React from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Code,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Link as LinkIcon,
  Image as ImageIcon,
  Table as TableIcon,
  Highlighter,
  PanelLeft,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/renderer/shared/utils/cn';
import { Button } from '@/renderer/shared/components/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/renderer/shared/components/DropdownMenu';

interface ToolbarProps {
  editor: Editor | null;
}

const Toolbar: React.FC<ToolbarProps> = ({ editor }) => {
  if (!editor) {
    return null;
  }

  const buttonClass = (isActive: boolean) =>
    cn(
      'p-1 rounded-md',
      isActive
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    );

  const setHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    editor.chain().focus().toggleHeading({ level }).run();
  };

  const setTextAlign = (align: 'left' | 'center' | 'right' | 'justify') => {
    editor.chain().focus().setTextAlign(align).run();
  };

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);

    // cancelled
    if (url === null) {
      return;
    }

    // empty
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    // update link
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const insertImage = () => {
    const url = window.prompt('Image URL');
    
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const LANGUAGES = [
    { label: 'Plain Text', value: 'plaintext' },
    { label: 'JavaScript', value: 'js' },
    { label: 'TypeScript', value: 'typescript' },
    { label: 'Python', value: 'python' },
    { label: 'HTML', value: 'html' },
    { label: 'CSS', value: 'css' },
    { label: 'JSON', value: 'json' },
    { label: 'Markdown', value: 'markdown' },
    { label: 'SQL', value: 'sql' },
    { label: 'Bash', value: 'bash' }
  ];

  const CALLOUT_TYPES = [
    { label: 'Info', value: 'info' },
    { label: 'Warning', value: 'warning' },
    { label: 'Error', value: 'error' },
    { label: 'Success', value: 'success' },
    { label: 'Note', value: 'note' },
    { label: 'Tip', value: 'tip' },
  ];

  return (
    <div className="flex items-center flex-wrap gap-0.5 py-1 px-1">
      {/* Text formatting */}
      <Button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={buttonClass(editor.isActive('bold'))}
        variant="ghost"
        size="icon"
        title="Bold"
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={buttonClass(editor.isActive('italic'))}
        variant="ghost"
        size="icon"
        title="Italic"
      >
        <Italic className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={buttonClass(editor.isActive('underline'))}
        variant="ghost"
        size="icon"
        title="Underline"
      >
        <Underline className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={buttonClass(editor.isActive('strike'))}
        variant="ghost"
        size="icon"
        title="Strikethrough"
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={buttonClass(editor.isActive('code'))}
        variant="ghost"
        size="icon"
        title="Code"
      >
        <Code className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        className={buttonClass(editor.isActive('highlight'))}
        variant="ghost"
        size="icon"
        title="Highlight"
      >
        <Highlighter className="h-3.5 w-3.5" />
      </Button>
      <div className="border-l border-muted h-4 mx-1" />

      {/* Lists */}
      <Button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={buttonClass(editor.isActive('bulletList'))}
        variant="ghost"
        size="icon"
        title="Bullet List"
      >
        <List className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={buttonClass(editor.isActive('orderedList'))}
        variant="ghost"
        size="icon"
        title="Ordered List"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        className={buttonClass(editor.isActive('taskList'))}
        variant="ghost"
        size="icon"
        title="Task List"
      >
        <ListChecks className="h-3.5 w-3.5" />
      </Button>

      <div className="border-l border-muted h-4 mx-1" />

      {/* Block elements */}
      <Button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={buttonClass(editor.isActive('blockquote'))}
        variant="ghost"
        size="icon"
        title="Blockquote"
      >
        <Quote className="h-3.5 w-3.5" />
      </Button>

      {/* Code block dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className={buttonClass(editor.isActive('codeBlock'))}
            variant="ghost"
            size="icon"
            title="Code Block"
          >
            <Code2 className="h-3.5 w-3.5" />
            <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {LANGUAGES.map(({ label, value }) => (
            <DropdownMenuItem
              key={value}
              onClick={() => editor.chain().focus().toggleCodeBlock({ language: value }).run()}
              className={editor.isActive('codeBlock', { language: value }) ? 'bg-primary/10 text-primary' : ''}
            >
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Callout dropdown (placeholder - implement later) */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className={buttonClass(editor.isActive('callout'))}
            variant="ghost"
            size="icon"
            title="Callout"
          >
            <PanelLeft className="h-3.5 w-3.5" />
            <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {CALLOUT_TYPES.map(({ label, value }) => (
            <DropdownMenuItem
              key={value}
              onClick={() => {
                // This would need to be implemented with a custom extension
                console.log(`Insert ${value} callout`);
              }}
            >
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="border-l border-muted h-4 mx-1" />

      {/* Headings */}
      <Button
        onClick={() => setHeading(1)}
        className={buttonClass(editor.isActive('heading', { level: 1 }))}
        variant="ghost"
        size="icon"
        title="Heading 1"
      >
        <Heading1 className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => setHeading(2)}
        className={buttonClass(editor.isActive('heading', { level: 2 }))}
        variant="ghost"
        size="icon"
        title="Heading 2"
      >
        <Heading2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => setHeading(3)}
        className={buttonClass(editor.isActive('heading', { level: 3 }))}
        variant="ghost"
        size="icon"
        title="Heading 3"
      >
        <Heading3 className="h-3.5 w-3.5" />
      </Button>

      <div className="border-l border-muted h-4 mx-1" />

      {/* Alignment */}
      <Button
        onClick={() => setTextAlign('left')}
        className={buttonClass(editor.isActive({ textAlign: 'left' }))}
        variant="ghost"
        size="icon"
        title="Align Left"
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => setTextAlign('center')}
        className={buttonClass(editor.isActive({ textAlign: 'center' }))}
        variant="ghost"
        size="icon"
        title="Align Center"
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => setTextAlign('right')}
        className={buttonClass(editor.isActive({ textAlign: 'right' }))}
        variant="ghost"
        size="icon"
        title="Align Right"
      >
        <AlignRight className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => setTextAlign('justify')}
        className={buttonClass(editor.isActive({ textAlign: 'justify' }))}
        variant="ghost"
        size="icon"
        title="Justify"
      >
        <AlignJustify className="h-3.5 w-3.5" />
      </Button>

      <div className="border-l border-muted h-4 mx-1" />

      {/* Links, Images and Tables */}
      <Button
        onClick={setLink}
        className={buttonClass(editor.isActive('link'))}
        variant="ghost"
        size="icon"
        title="Link"
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={insertImage}
        variant="ghost"
        size="icon"
        title="Image"
      >
        <ImageIcon className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={insertTable}
        variant="ghost"
        size="icon"
        title="Table"
      >
        <TableIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};

export default Toolbar; 