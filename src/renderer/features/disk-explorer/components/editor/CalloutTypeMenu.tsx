import React, { useEffect, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { Bot, Bug, Check, CircleCheck, CircleHelp, ClipboardList, Flame, Info, List, Pencil, Quote, TriangleAlert, X, Zap, type LucideIcon } from 'lucide-react';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/renderer/shared/ui';
import { CALLOUT_FAMILIES, calloutFamily, calloutHeadAt, retypeCallout } from './callouts';

const ICONS: Record<string, LucideIcon> = {
  pencil: Pencil,
  'clipboard-list': ClipboardList,
  info: Info,
  'circle-check': CircleCheck,
  flame: Flame,
  check: Check,
  'circle-help': CircleHelp,
  'triangle-alert': TriangleAlert,
  x: X,
  zap: Zap,
  bug: Bug,
  list: List,
  quote: Quote,
  bot: Bot,
};

interface CalloutTypeMenuProps {
  view: EditorView;
}

/**
 * A click on a callout's icon in a document: a menu of Obsidian's callout
 * types. Picking one rewrites only the type word, in its case, and keeps
 * the fold sign and title.
 */
export const CalloutTypeMenu: React.FC<CalloutTypeMenuProps> = ({ view }) => {
  const [menu, setMenu] = useState<{ x: number; y: number; head: number } | null>(null);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const icon = event.button === 0 && event.target instanceof Element ? event.target.closest('[data-callout-icon]') : null;
      if (!icon || !view.contentDOM.contains(icon)) return;
      const head = calloutHeadAt(view.state, view.posAtDOM(icon));
      if (head === null) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = icon.getBoundingClientRect();
      setMenu({ x: rect.left, y: rect.bottom + 4, head });
    };
    view.contentDOM.addEventListener('mousedown', onMouseDown, true);
    return () => view.contentDOM.removeEventListener('mousedown', onMouseDown, true);
  }, [view]);

  if (!menu) return null;
  const word = /\[!([\w-]+)\]/.exec(view.state.doc.lineAt(menu.head).text)?.[1] ?? 'note';
  const current = calloutFamily(word).type;
  const pick = (type: string) => {
    const change = retypeCallout(view.state, menu.head, type);
    if (change && type !== current) view.dispatch({ changes: change, userEvent: 'input' });
  };
  return (
    <Menu open onOpenChange={(open) => { if (!open) setMenu(null); }}>
      <MenuTrigger asChild>
        <span aria-hidden style={{ position: 'fixed', top: menu.y, left: menu.x, width: 0, height: 0 }} />
      </MenuTrigger>
      <MenuContent align="start" data-callout-menu="" onCloseAutoFocus={(event) => { event.preventDefault(); view.focus(); }}>
        <MenuRadioGroup value={current} onValueChange={pick}>
          {CALLOUT_FAMILIES.map((family) => {
            const Icon = ICONS[family.icon];
            return (
              <MenuRadioItem key={family.type} value={family.type}>
                <Icon aria-hidden className="h-4 w-4" />
                {family.label}
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
};
