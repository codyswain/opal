import * as React from 'react';
import { cn } from '@/renderer/shared/utils';
import type { DayChat } from '@/types/day';
import { openTitle } from '../dayLinks';
import { shortDayName } from '../dayRule';
import { RowTime, rowStyles } from './DayCard';
import { useDaySidebarContext, vaultRelative } from './daySidebarContext';

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** The row's time is the last activity that day; the tooltip says so and gives when the chat was made. */
export function chatTitle(chat: DayChat, file: string): string {
  const made = chat.created
    ? chat.isNew
      ? `Created ${chat.created.slice(11, 16)}`
      : `Created ${shortDayName(chat.created.slice(0, 10))}`
    : 'Created earlier';
  const prompts = chat.prompts ? `. ${plural(chat.prompts, 'prompt', 'prompts')} this day` : '';
  const tool = chat.tool === 'codex' ? 'Codex' : chat.tool === 'claude' ? 'Claude Code' : null;
  return `${openTitle(file)}\nLast active ${chat.last}. ${made}${prompts}.${tool ? `\n${tool}.` : ''}`;
}

/**
 * A chat created or continued that day. A click opens its chat page: the thread card, with its sessions below.
 * Only an archived chat is marked; whether a chat is new that day is in the tooltip.
 */
export function ChatRow({ chat }: { chat: DayChat }) {
  const { openPath, root } = useDaySidebarContext();
  const archived = chat.status === 'archived';
  return (
    <button
      type="button"
      title={chatTitle(chat, vaultRelative(root, chat.path))}
      onClick={(event) => openPath(chat.path, event)}
      onAuxClick={(event) => event.button === 1 && openPath(chat.path, event)}
      className={rowStyles}
    >
      <RowTime>{chat.last}</RowTime>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className={cn('min-w-0 truncate', archived && 'text-foreground-tertiary')}>{chat.title}</span>
        {chat.tool === 'codex' ? <span className="flex-none text-control text-foreground-tertiary">Codex</span> : null}
      </span>
      {archived ? <span className="flex-none text-2xs text-foreground-tertiary">Archived</span> : null}
    </button>
  );
}
