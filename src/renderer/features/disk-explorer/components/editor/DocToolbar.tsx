import React, { useLayoutEffect, useRef, useState } from 'react';
import { redo, undo } from '@codemirror/commands';
import type { StateCommand } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  Bold,
  ChevronDown,
  Code,
  Ellipsis,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Plus,
  Redo2,
  RemoveFormatting,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '@/renderer/shared/ui';
import { linkAroundCode, toggleCodeBlock } from './codeBlocks';
import { editLink } from './docMode';
import { insertItems } from './extensionPoints';
import { clearFormattingAndCode, indentList, setHeading, toggleInlineCode, toggleList, toggleMarker } from './formatCommands';
import type { FormatState } from './formatState';

const STYLES = ['Normal text', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6'];

interface Action {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  /** Set for a style button, which shows whether the selection has the style. */
  pressed?: boolean;
  disabled?: boolean;
  run: () => void;
}

type Item = Action | 'style' | 'insert' | 'separator';

// Widths in px, so the row knows what fits before it draws: a 28px button and its gap, a rule, the style menu, the Insert menu.
const BUTTON_WIDTH = 30;
const SEPARATOR_WIDTH = 9;
const STYLE_WIDTH = 124;
const INSERT_WIDTH = 46;
const widthOf = (item: Item) => (item === 'separator' ? SEPARATOR_WIDTH : item === 'style' ? STYLE_WIDTH : item === 'insert' ? INSERT_WIDTH : BUTTON_WIDTH);

/** How many items fit in `width`, leaving room for the "more" button when some do not. */
function fitting(items: readonly Item[], width: number): number {
  if (width <= 0 || items.reduce((sum, item) => sum + widthOf(item), 0) <= width) return items.length;
  let used = BUTTON_WIDTH;
  let count = 0;
  for (const item of items) {
    if (used + widthOf(item) > width) break;
    used += widthOf(item);
    count += 1;
  }
  while (count > 0 && items[count - 1] === 'separator') count -= 1;
  return count;
}

// A click on the toolbar leaves focus, and so the caret, in the text.
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

interface DocToolbarProps {
  view: EditorView;
  format: FormatState;
}

/**
 * A document's formatting toolbar, in Google Docs' order, inside the page
 * card above the text. Buttons that do not fit move into a "more" menu.
 * Arrow keys move between buttons and one of them is in the tab order;
 * Escape goes back to the text, and Option+F10 or ⌃⌥T in the text comes here.
 */
export const DocToolbar: React.FC<DocToolbarProps> = ({ view, format }) => {
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState('undo');

  useLayoutEffect(() => {
    const element = row.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const { paddingLeft, paddingRight } = getComputedStyle(element);
      setWidth(element.clientWidth - (Number.parseFloat(paddingLeft) || 0) - (Number.parseFloat(paddingRight) || 0));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const command = (run: StateCommand) => () => { run(view); };
  const inserts = view.state.facet(insertItems);
  // Formatting does not apply in a code block.
  const inCode = format.code === 'block';
  // In a code block the menu stays open for its Code block item, which unwraps the block; the headings are off.
  const styleDisabled = format.headingDisabled && !inCode;

  const items: Item[] = [
    { id: 'undo', label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !format.canUndo, run: command(undo) },
    { id: 'redo', label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !format.canRedo, run: command(redo) },
    'separator',
    'style',
    'separator',
    { id: 'bold', label: 'Bold', icon: Bold, shortcut: '⌘B', pressed: format.bold, disabled: inCode, run: command(toggleMarker('**')) },
    { id: 'italic', label: 'Italic', icon: Italic, shortcut: '⌘I', pressed: format.italic, disabled: inCode, run: command(toggleMarker('*')) },
    { id: 'code', label: 'Code', icon: Code, shortcut: '⌘E', pressed: format.code === 'inline', disabled: inCode, run: command(toggleInlineCode) },
    'separator',
    { id: 'link', label: 'Link', icon: Link, shortcut: '⌘K', pressed: format.link, disabled: inCode, run: () => { if (!linkAroundCode(view)) editLink(view); } },
    'insert',
    'separator',
    { id: 'checklist', label: 'Checklist', icon: ListTodo, shortcut: '⇧⌘9', pressed: format.list === 'task', disabled: inCode, run: command(toggleList('task')) },
    { id: 'bullets', label: 'Bulleted list', icon: List, shortcut: '⇧⌘8', pressed: format.list === 'bullet', disabled: inCode, run: command(toggleList('bullet')) },
    { id: 'numbers', label: 'Numbered list', icon: ListOrdered, shortcut: '⇧⌘7', pressed: format.list === 'number', disabled: inCode, run: command(toggleList('number')) },
    'separator',
    { id: 'outdent', label: 'Decrease indent', icon: IndentDecrease, shortcut: '⇧Tab', disabled: !format.inList, run: command(indentList(false)) },
    { id: 'indent', label: 'Increase indent', icon: IndentIncrease, shortcut: 'Tab', disabled: !format.inList, run: command(indentList(true)) },
    'separator',
    { id: 'clear', label: 'Clear formatting', icon: RemoveFormatting, disabled: inCode, run: command(clearFormattingAndCode) },
  ];
  const count = fitting(items, width);
  const shown = items.slice(0, count);
  const hidden = items.slice(count).filter((item): item is Action | 'style' | 'insert' => item !== 'separator');
  // The one button in the tab order: the last one focused, or the first that can take focus.
  const focusable = shown.flatMap((item) => (item === 'separator' || (item === 'style' && styleDisabled) ? [] : item === 'style' || item === 'insert' ? [item] : item.disabled ? [] : [item.id]));
  if (hidden.length > 0) focusable.push('more');
  const tabStop = focusable.includes(current) ? current : focusable[0];
  const tabIndex = (id: string) => (id === tabStop ? 0 : -1);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(row.current?.querySelectorAll<HTMLElement>('[data-toolbar-item]:not(:disabled)') ?? [])];
    const at = buttons.indexOf(event.target as HTMLElement);
    if (at === -1) return;
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1 }[event.key];
    if (event.key === 'Escape') {
      event.preventDefault();
      view.focus();
    } else if (next !== undefined) {
      event.preventDefault();
      buttons[(next + buttons.length) % buttons.length]?.focus();
    }
  };
  // Menus give focus back to the text when they close.
  const backToText = (event: Event) => {
    event.preventDefault();
    view.focus();
  };
  const styleName = inCode ? 'Code block' : format.heading === null ? 'Mixed styles' : STYLES[format.heading];
  const insertMenuItems = inserts.map((item) => {
    const Icon = item.icon;
    return (
      <MenuItem key={item.id} className="gap-2" onSelect={() => { void item.run(view); }}>
        <Icon aria-hidden className="h-4 w-4" />
        {item.label}
        {item.shortcut ? <MenuShortcut>{item.shortcut}</MenuShortcut> : null}
      </MenuItem>
    );
  });
  const styleItems = (
    <>
      <MenuRadioGroup value={inCode ? '' : String(format.heading ?? '')} onValueChange={(level) => setHeading(Number(level))(view)}>
        {STYLES.map((name, level) => (
          <MenuRadioItem key={name} value={String(level)} disabled={inCode}>{name}</MenuRadioItem>
        ))}
      </MenuRadioGroup>
      <MenuCheckboxItem checked={inCode} onSelect={() => { toggleCodeBlock(view); }}>
        Code block
        <MenuShortcut>⌥⌘C</MenuShortcut>
      </MenuCheckboxItem>
    </>
  );

  return (
    <div
      ref={row}
      role="toolbar"
      aria-label="Formatting"
      aria-keyshortcuts="Alt+F10 Control+Alt+T"
      className="opal-doc-toolbar"
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const id = (event.target as HTMLElement).dataset.toolbarItem;
        if (id) setCurrent(id);
      }}
    >
      {shown.map((item, index) => {
        if (item === 'separator') return <span key={`separator-${index}`} aria-hidden className="opal-doc-toolbar-rule" />;
        if (item === 'insert') {
          return (
            <Menu key="insert">
              <MenuTrigger asChild>
                <button type="button" data-toolbar-item="insert" tabIndex={tabIndex('insert')} aria-label="Insert" title="Insert" onMouseDown={keepFocus} className="opal-doc-toolbar-insert">
                  <Plus aria-hidden className="h-4 w-4" />
                  <ChevronDown aria-hidden className="h-3 w-3" />
                </button>
              </MenuTrigger>
              <MenuContent align="start" onCloseAutoFocus={backToText}>{insertMenuItems}</MenuContent>
            </Menu>
          );
        }
        if (item === 'style') {
          return (
            <Menu key="style">
              <MenuTrigger asChild>
                <button type="button" data-toolbar-item="style" tabIndex={tabIndex('style')} aria-label={`Style, ${styleName}`} disabled={styleDisabled} onMouseDown={keepFocus} className="opal-doc-toolbar-style">
                  <span className="truncate">{styleName}</span>
                  <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0" />
                </button>
              </MenuTrigger>
              <MenuContent align="start" onCloseAutoFocus={backToText}>{styleItems}</MenuContent>
            </Menu>
          );
        }
        const Icon = item.icon;
        return (
          <IconButton
            key={item.id}
            label={item.label}
            shortcut={item.shortcut}
            active={item.pressed}
            disabled={item.disabled}
            data-toolbar-item={item.id}
            tabIndex={tabIndex(item.id)}
            onMouseDown={keepFocus}
            onClick={item.run}
          >
            <Icon aria-hidden className="h-4 w-4" />
          </IconButton>
        );
      })}
      {hidden.length > 0 ? (
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="More" data-toolbar-item="more" tabIndex={tabIndex('more')} onMouseDown={keepFocus}>
              <Ellipsis aria-hidden className="h-4 w-4" />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end" onCloseAutoFocus={backToText}>
            {hidden.map((item) => {
              if (item === 'style') {
                return (
                  <MenuSub key="style">
                    <MenuSubTrigger>Style</MenuSubTrigger>
                    <MenuSubContent>{styleItems}</MenuSubContent>
                  </MenuSub>
                );
              }
              if (item === 'insert') {
                return (
                  <MenuSub key="insert">
                    <MenuSubTrigger>Insert</MenuSubTrigger>
                    <MenuSubContent>{insertMenuItems}</MenuSubContent>
                  </MenuSub>
                );
              }
              return item.pressed === undefined ? (
                <MenuItem key={item.id} disabled={item.disabled} onSelect={item.run}>{item.label}</MenuItem>
              ) : (
                <MenuCheckboxItem key={item.id} checked={item.pressed} onSelect={item.run}>{item.label}</MenuCheckboxItem>
              );
            })}
          </MenuContent>
        </Menu>
      ) : null}
    </div>
  );
};
