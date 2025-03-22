import React from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  Quote,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/renderer/shared/utils';
import { Button } from '@/renderer/shared/components/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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

  const setLanguage = (language: string) => {
    editor.chain().focus().toggleCodeBlock({ language }).run();
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

  return (
    <div className="flex items-center flex-wrap gap-0.5 py-1 px-1">
      <Button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={buttonClass(editor.isActive('bold'))}
        variant="ghost"
        size="icon"
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={buttonClass(editor.isActive('italic'))}
        variant="ghost"
        size="icon"
      >
        <Italic className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={buttonClass(editor.isActive('strike'))}
        variant="ghost"
        size="icon"
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={buttonClass(editor.isActive('code'))}
        variant="ghost"
        size="icon"
      >
        <Code className="h-3.5 w-3.5" />
      </Button>
      <div className="border-l border-muted h-4 mx-1" />
      <Button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={buttonClass(editor.isActive('bulletList'))}
        variant="ghost"
        size="icon"
      >
        <List className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={buttonClass(editor.isActive('orderedList'))}
        variant="ghost"
        size="icon"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </Button>
      <div className="border-l border-muted h-4 mx-1" />
      <Button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={buttonClass(editor.isActive('blockquote'))}
        variant="ghost"
        size="icon"
      >
        <Quote className="h-3.5 w-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className={buttonClass(editor.isActive('codeBlock'))}
            variant="ghost"
            size="icon"
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
      <div className="border-l border-muted h-4 mx-1" />
      <Button
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={buttonClass(editor.isActive('heading', { level: 1 }))}
        variant="ghost"
        size="icon"
      >
        <Heading1 className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={buttonClass(editor.isActive('heading', { level: 2 }))}
        variant="ghost"
        size="icon"
      >
        <Heading2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={buttonClass(editor.isActive('heading', { level: 3 }))}
        variant="ghost"
        size="icon"
      >
        <Heading3 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};

export default Toolbar;