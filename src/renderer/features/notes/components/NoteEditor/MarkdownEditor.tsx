// src/features/notes/components/MarkdownEditor.tsx

import React, { useRef, useState, useEffect } from 'react';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Code,
  Quote,
  Image as ImageIcon,
  Link as LinkIcon,
  Strikethrough,
  Terminal,
  Heading1,
  Heading2,
  Heading3,
  Minus,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/renderer/shared/components/Tooltip';
import { Button } from '@/renderer/shared/components/Button';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ value, onChange }) => {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPosition, setCursorPosition] = useState(0);

  useEffect(() => {
    const textarea = textAreaRef.current;
    if (textarea) {
      textarea.selectionStart = cursorPosition;
      textarea.selectionEnd = cursorPosition;
    }
  }, [cursorPosition]);

  const insertAtCursor = (
    beforeText: string,
    afterText = '',
    defaultText = '',
    cursorAdjustment = 0
  ) => {
    const textarea = textAreaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end) || defaultText;

    const newText =
      value.substring(0, start) +
      beforeText +
      selectedText +
      afterText +
      value.substring(end);

    onChange(newText);

    // Update cursor position after insertion
    const newCursorPosition = start + beforeText.length + selectedText.length + cursorAdjustment;
    setCursorPosition(newCursorPosition);

    textarea.focus();
  };

  // Toolbar action handlers
  const handleBold = () => {
    insertAtCursor('**', '**', 'bold text');
  };

  const handleItalic = () => {
    insertAtCursor('*', '*', 'italic text');
  };

  const handleStrikethrough = () => {
    insertAtCursor('~~', '~~', 'strikethrough text');
  };

  const handleCode = () => {
    insertAtCursor('`', '`', 'code');
  };

  const handleCodeBlock = () => {
    insertAtCursor('\n```\n', '\n```\n', 'code block', -4);
  };

  const handleBlockquote = () => {
    insertAtCursor('\n> ', '', 'quote');
  };

  const handleUnorderedList = () => {
    insertAtCursor('\n- ', '', 'list item');
  };

  const handleOrderedList = () => {
    insertAtCursor('\n1. ', '', 'list item');
  };

  const handleImage = () => {
    insertAtCursor('![Alt text](', ')', 'image_url');
  };

  const handleLink = () => {
    insertAtCursor('[', '](url)', 'link text');
  };

  const handleHeading = (level: number) => {
    const hashes = '#'.repeat(level);
    insertAtCursor(`\n${hashes} `, '', `Heading ${level}`);
  };

  const handleHorizontalRule = () => {
    insertAtCursor('\n---\n', '', '');
  };

  const toolbarButtons = [
    { icon: Bold, action: handleBold, label: 'Bold' },
    { icon: Italic, action: handleItalic, label: 'Italic' },
    { icon: Strikethrough, action: handleStrikethrough, label: 'Strikethrough' },
    { icon: LinkIcon, action: handleLink, label: 'Link' },
    { icon: ImageIcon, action: handleImage, label: 'Image' },
    { icon: Code, action: handleCode, label: 'Inline Code' },
    { icon: Terminal, action: handleCodeBlock, label: 'Code Block' },
    { icon: Quote, action: handleBlockquote, label: 'Blockquote' },
    { icon: List, action: handleUnorderedList, label: 'Unordered List' },
    { icon: ListOrdered, action: handleOrderedList, label: 'Ordered List' },
    { icon: Heading1, action: () => handleHeading(1), label: 'Heading 1' },
    { icon: Heading2, action: () => handleHeading(2), label: 'Heading 2' },
    { icon: Heading3, action: () => handleHeading(3), label: 'Heading 3' },
    { icon: Minus, action: handleHorizontalRule, label: 'Horizontal Rule' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 mb-2">
        {toolbarButtons.map(({ icon: Icon, action, label }) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={action}
                aria-label={label}
              >
                <Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{label}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Editor */}
      <textarea
        ref={textAreaRef}
        className="w-full h-full border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md resize-none overflow-auto bg-background text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};

export default MarkdownEditor;
