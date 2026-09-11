import React, { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Bold, Code, Heading1, Heading2, Heading3, Italic, Link2, Strikethrough } from 'lucide-react';
import { cn } from '@/renderer/shared/utils';

interface EditorBubbleMenuProps {
  editor: Editor;
  /** The scrolling container the menu is positioned inside. */
  container: HTMLElement | null;
}

interface MenuPosition {
  top: number;
  left: number;
}

const buttonStyles = 'rounded-md p-1.5 text-foreground-secondary hover:bg-surface-hover hover:text-foreground';

/**
 * Formatting for the current selection, positioned from the selection's own
 * coordinates so it needs no popper library. Nothing here is reachable
 * without a selection.
 */
export const EditorBubbleMenu: React.FC<EditorBubbleMenuProps> = ({ editor, container }) => {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || !editor.isFocused || editor.isActive('codeBlock') || !container) {
        setPosition(null);
        return;
      }
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        const bounds = container.getBoundingClientRect();
        setPosition({
          top: Math.max(0, start.top - bounds.top + container.scrollTop - 44),
          left: Math.max(8, (start.left + end.left) / 2 - bounds.left + container.scrollLeft),
        });
      } catch {
        setPosition(null);
      }
      setTick((value) => value + 1);
    };
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    editor.on('focus', update);
    editor.on('blur', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      editor.off('focus', update);
      editor.off('blur', update);
    };
  }, [editor, container]);

  if (!position) return null;

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', previous ?? 'https://');
    if (url === null) return;
    if (url.trim() === '') { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };
  const item = (label: string, active: boolean, onClick: () => void, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      data-disk-shortcuts-ignore="true"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(buttonStyles, active && 'bg-surface-selected text-foreground')}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      data-testid="editor-bubble-menu"
      className="opal-editor-bubble absolute z-10 -translate-x-1/2"
      style={{ top: position.top, left: position.left }}
    >
      {item('Bold', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), Bold)}
      {item('Italic', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), Italic)}
      {item('Strikethrough', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), Strikethrough)}
      {item('Code', editor.isActive('code'), () => editor.chain().focus().toggleCode().run(), Code)}
      {item('Heading 1', editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), Heading1)}
      {item('Heading 2', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), Heading2)}
      {item('Heading 3', editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), Heading3)}
      {item('Link', editor.isActive('link'), setLink, Link2)}
    </div>
  );
};
