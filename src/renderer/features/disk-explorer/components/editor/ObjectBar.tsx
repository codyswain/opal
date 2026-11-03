import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import { ChevronDown } from 'lucide-react';
import { IconButton, Menu, MenuContent, MenuItem, MenuShortcut, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '@/renderer/shared/ui';
import { objectAt, objectKind, type ObjectAction, type PageObject } from './extensionPoints';
import { objectBars, objectFrame, setFrame } from './objectFrame';
import './objects.css';

const GAP = 8;

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Where the object is on screen: a block widget's element, or its first and last characters. */
function objectBox(view: EditorView, obj: PageObject, block: boolean): Box | null {
  const element = block ? view.contentDOM.querySelector('[data-object-framed]') : null;
  if (element) {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  }
  const start = view.coordsAtPos(obj.from, 1);
  const end = view.coordsAtPos(obj.to, -1);
  if (!start || !end) return null;
  if (block) {
    const content = view.contentDOM.getBoundingClientRect();
    return { top: start.top, bottom: end.bottom, left: content.left, right: content.right };
  }
  return { top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom), left: start.left, right: end.top === start.top ? end.right : start.right };
}

/**
 * The bar's place: 8px under the object and centred on it, above it near
 * the bottom of the visible area, and inside the visible area for an object
 * taller than it or in a narrow split. Null when the object is out of view.
 */
export function placeBar(box: Box, bar: { width: number; height: number }, visible: Box): { top: number; left: number } | null {
  if (box.bottom < visible.top || box.top > visible.bottom) return null;
  let top = box.bottom + GAP;
  if (top + bar.height > visible.bottom - GAP) {
    const above = box.top - GAP - bar.height;
    top = above >= visible.top + GAP ? above : visible.bottom - GAP - bar.height;
  }
  top = Math.max(visible.top + GAP, top);
  const centred = (box.left + box.right) / 2 - bar.width / 2;
  const left = Math.max(visible.left + GAP, Math.min(centred, visible.right - GAP - bar.width));
  return { top, left };
}

function visibleArea(view: EditorView): Box {
  const scroller = view.scrollDOM.getBoundingClientRect();
  return {
    top: Math.max(scroller.top, 0),
    bottom: Math.min(scroller.bottom, window.innerHeight),
    left: Math.max(scroller.left, 0),
    right: Math.min(scroller.right, window.innerWidth),
  };
}

// A click on the bar leaves focus, and so the caret, in the text.
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

interface ActionsProps {
  view: EditorView;
  obj: PageObject;
  actions: readonly ObjectAction[];
}

/** An action's menu items, with submenus for actions that hold more. */
const MenuItems: React.FC<ActionsProps> = ({ view, obj, actions }) => (
  <>
    {actions.map((action) => {
      const Icon = action.icon;
      if (action.items) {
        return (
          <MenuSub key={action.id}>
            <MenuSubTrigger disabled={action.disabled}>{action.label}</MenuSubTrigger>
            <MenuSubContent><MenuItems view={view} obj={obj} actions={action.items} /></MenuSubContent>
          </MenuSub>
        );
      }
      return (
        <MenuItem key={action.id} className="gap-2" disabled={action.disabled} onSelect={() => action.run?.(view, obj)}>
          {Icon ? <Icon aria-hidden className="h-4 w-4" /> : null}
          {action.label}
          {action.shortcut ? <MenuShortcut>{action.shortcut}</MenuShortcut> : null}
        </MenuItem>
      );
    })}
  </>
);

interface ObjectBarProps {
  view: EditorView;
  /** The framed object, which the bar follows. */
  frame: PageObject;
}

/**
 * The bar for a framed object: where it points, then the actions its kind
 * gives. Arrow keys move between the buttons, one of which is in the tab
 * order; Escape goes back to the text, and Option+F10 or ⌃⌥T there comes
 * here.
 */
export const ObjectBar: React.FC<ObjectBarProps> = ({ view, frame }) => {
  const bar = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const [current, setCurrent] = useState(0);
  const kind = objectKind(view.state, frame.kind);
  const actions = kind?.actions(view.state, frame) ?? [];
  const destination = kind?.destination?.(view.state, frame) ?? null;
  const block = Boolean(kind?.block);

  useLayoutEffect(() => {
    const element = bar.current;
    if (element) objectBars.set(view, element);
    return () => { if (element && objectBars.get(view) === element) objectBars.delete(view); };
  });

  useLayoutEffect(() => {
    let frameRequest = 0;
    const measure = () => {
      cancelAnimationFrame(frameRequest);
      frameRequest = requestAnimationFrame(() => {
        const box = objectBox(view, frame, block);
        const size = bar.current?.getBoundingClientRect();
        setPlace(box && size ? placeBar(box, { width: size.width, height: size.height || 36 }, visibleArea(view)) : null);
      });
    };
    measure();
    view.scrollDOM.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frameRequest);
      view.scrollDOM.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [view, frame, block]);

  if (actions.length === 0 && !destination) return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(bar.current?.querySelectorAll<HTMLElement>('[data-bar-item]:not(:disabled)') ?? [])];
    const at = buttons.indexOf(event.target as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      view.focus();
      return;
    }
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1 }[event.key];
    if (at === -1 || next === undefined) return;
    event.preventDefault();
    buttons[(next + buttons.length) % buttons.length]?.focus();
  };
  const backToText = (event: Event) => {
    event.preventDefault();
    view.focus();
  };
  const tabIndex = (index: number) => (index === Math.min(current, actions.length - 1) ? 0 : -1);

  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label={destination ? `${frame.kind}, ${destination}` : frame.kind}
      data-object-bar={frame.kind}
      className="opal-object-bar"
      style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
    >
      {destination ? <span className="opal-object-bar-destination" title={destination}>{destination}</span> : null}
      {destination && actions.length > 0 ? <span aria-hidden className="opal-object-bar-rule" /> : null}
      {actions.map((action, index) => {
        const Icon = action.icon;
        const focus = () => setCurrent(index);
        if (action.items) {
          return (
            <Menu key={action.id}>
              <MenuTrigger asChild>
                <button type="button" data-bar-item={action.id} tabIndex={tabIndex(index)} disabled={action.disabled} onFocus={focus} onMouseDown={keepFocus} className="opal-object-bar-text">
                  {action.label}
                  <ChevronDown aria-hidden className="h-3 w-3" />
                </button>
              </MenuTrigger>
              <MenuContent align="start" onCloseAutoFocus={backToText}>
                <MenuItems view={view} obj={frame} actions={action.items} />
              </MenuContent>
            </Menu>
          );
        }
        const run = () => {
          action.run?.(view, frame);
          view.focus();
        };
        return Icon ? (
          <IconButton key={action.id} label={action.label} shortcut={action.shortcut} disabled={action.disabled} data-bar-item={action.id} tabIndex={tabIndex(index)} onFocus={focus} onMouseDown={keepFocus} onClick={run}>
            <Icon aria-hidden className="h-4 w-4" />
          </IconButton>
        ) : (
          <button key={action.id} type="button" data-bar-item={action.id} tabIndex={tabIndex(index)} disabled={action.disabled} onFocus={focus} onMouseDown={keepFocus} onClick={run} className="opal-object-bar-text">
            {action.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
};

interface ObjectMenuProps {
  view: EditorView;
}

/**
 * Right-click on an object: frames it and shows the bar's items as a menu
 * at the pointer. Elsewhere the page keeps its own right-click.
 */
export const ObjectMenu: React.FC<ObjectMenuProps> = ({ view }) => {
  const [menu, setMenu] = useState<{ x: number; y: number; obj: PageObject } | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const framed = view.state.field(objectFrame, false);
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const element = event.target instanceof Element ? event.target.closest('[data-object]') : null;
      const obj = element ? objectAt(view.state, view.posAtDOM(element), 1) : framed && at !== null && framed.from <= at && at <= framed.to ? framed : null;
      if (!obj || (objectKind(view.state, obj.kind)?.actions(view.state, obj).length ?? 0) === 0) return;
      event.preventDefault();
      view.dispatch({ effects: setFrame.of(obj) });
      setMenu({ x: event.clientX, y: event.clientY, obj });
    };
    view.contentDOM.addEventListener('contextmenu', onContextMenu);
    return () => view.contentDOM.removeEventListener('contextmenu', onContextMenu);
  }, [view]);

  if (!menu) return null;
  const actions = objectKind(view.state, menu.obj.kind)?.actions(view.state, menu.obj) ?? [];
  return (
    <Menu open onOpenChange={(open) => { if (!open) setMenu(null); }}>
      <MenuTrigger asChild>
        <span aria-hidden style={{ position: 'fixed', top: menu.y, left: menu.x, width: 0, height: 0 }} />
      </MenuTrigger>
      <MenuContent align="start" data-object-menu={menu.obj.kind} onCloseAutoFocus={(event) => { event.preventDefault(); view.focus(); }}>
        <MenuItems view={view} obj={menu.obj} actions={actions} />
      </MenuContent>
    </Menu>
  );
};
