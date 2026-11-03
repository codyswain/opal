import React, { useEffect, useState } from 'react';
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Bot, Bug, Check, CircleCheck, CircleHelp, ClipboardList, Flame, Info, List, Pencil, Quote, TriangleAlert, X, Zap, type LucideIcon } from 'lucide-react';
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '@/renderer/shared/ui';
import { CALLOUT_FAMILIES, calloutFamily, calloutHeadAt, foldSignAt, refoldCallout, retypeCallout, type FoldSign } from './callouts';

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

const FOLDS: { value: string; sign: FoldSign; label: string }[] = [
  { value: 'none', sign: '', label: 'Always open' },
  { value: 'open', sign: '+', label: 'Foldable, open' },
  { value: 'folded', sign: '-', label: 'Foldable, folded' },
];

/**
 * A click on a callout's icon in a document: a menu of Obsidian's callout
 * types and whether it folds. Picking a type
 * rewrites only the type word, in its case; picking a fold writes only the
 * sign after "[!type]". The menu closes when the page changes under it.
 */
export const CalloutTypeMenu: React.FC<CalloutTypeMenuProps> = ({ view }) => {
  const [menu, setMenu] = useState<{ x: number; y: number; head: number; doc: Text } | null>(null);

  useEffect(() => {
    const open = (head: number, icon: Element) => {
      const rect = icon.getBoundingClientRect();
      setMenu({ x: rect.left, y: rect.bottom + 4, head, doc: view.state.doc });
    };
    const onMouseDown = (event: MouseEvent) => {
      const icon = event.button === 0 && event.target instanceof Element ? event.target.closest('[data-callout-icon]') : null;
      if (!icon || !view.contentDOM.contains(icon)) return;
      const head = calloutHeadAt(view.state, view.posAtDOM(icon));
      if (head === null) return;
      event.preventDefault();
      event.stopPropagation();
      open(head, icon);
    };
    view.contentDOM.addEventListener('mousedown', onMouseDown, true);
    return () => view.contentDOM.removeEventListener('mousedown', onMouseDown, true);
  }, [view]);

  // An edit since the menu opened, such as an agent's merge, may have moved or removed the callout.
  if (!menu || view.state.doc !== menu.doc) return null;
  const word = /\[!([\w-]+)\]/.exec(view.state.doc.lineAt(menu.head).text)?.[1] ?? 'note';
  const current = calloutFamily(word).type;
  const pick = (type: string) => {
    const change = retypeCallout(view.state, menu.head, type);
    if (change && type !== current) view.dispatch({ changes: change, userEvent: 'input' });
  };
  const fold = (value: string) => {
    const change = refoldCallout(view.state, menu.head, FOLDS.find((each) => each.value === value)?.sign ?? '');
    if (change) view.dispatch({ changes: change, userEvent: 'input' });
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
              <MenuRadioItem key={family.type} value={family.type} className="gap-2">
                <Icon aria-hidden className="h-4 w-4" />
                {family.label}
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>Fold</MenuLabel>
        <MenuRadioGroup value={FOLDS.find((each) => each.sign === foldSignAt(view.state, menu.head))?.value} onValueChange={fold}>
          {FOLDS.map(({ value, label }) => <MenuRadioItem key={value} value={value}>{label}</MenuRadioItem>)}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
};
