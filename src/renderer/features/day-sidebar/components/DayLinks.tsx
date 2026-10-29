import * as React from 'react';
import { ArrowUpRight, FileText, MessageSquare, User, Video, type LucideIcon } from 'lucide-react';
import { cn } from '@/renderer/shared/utils';
import type { DayLink } from '@/types/day';
import { folderName, linkTitle, serviceName, vaultLinkKind, type VaultLinkKind } from '../dayLinks';
import { useDaySidebarContext } from './daySidebarContext';

const VAULT_ICONS: Record<VaultLinkKind, LucideIcon> = {
  chat: MessageSquare,
  recording: Video,
  person: User,
  note: FileText,
};

/** An arrow for a link that leaves the app; a file, chat, recording or person icon for a vault file. */
export function linkIcon(link: DayLink): LucideIcon {
  return link.external ? ArrowUpRight : VAULT_ICONS[vaultLinkKind(link)];
}

/** Opens an external link in the default browser, which the main process allows for web and mail links. */
function openExternal(event: React.MouseEvent, url: string) {
  event.preventDefault();
  window.open(url, '_blank');
}

interface LinkTargetProps {
  link: DayLink;
  className: string;
  children: React.ReactNode;
}

/**
 * A link as the control that follows it: an anchor for an external link, a
 * button for a vault file, and plain text for a vault target that is not
 * there.
 */
function LinkTarget({ children, className, link }: LinkTargetProps) {
  const { openPath } = useDaySidebarContext();
  const title = linkTitle(link);
  if (link.external) {
    return (
      <a
        href={link.target}
        target="_blank"
        rel="noreferrer"
        title={title}
        onClick={(event) => openExternal(event, link.target)}
        onAuxClick={(event) => event.button === 1 && openExternal(event, link.target)}
        className={className}
      >
        {children}
      </a>
    );
  }
  const path = link.path;
  if (!path) {
    return (
      <span title={title} className={cn(className, 'pointer-events-none opacity-60')}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => openPath(path, event)}
      onAuxClick={(event) => event.button === 1 && openPath(path, event)}
      className={className}
    >
      {children}
    </button>
  );
}

/** The first link under a log entry at rest. */
export function LinkChip({ link }: { link: DayLink }) {
  const Icon = linkIcon(link);
  return (
    <LinkTarget
      link={link}
      className="group/chip -ml-[5px] inline-flex h-[18px] min-w-0 flex-[0_1_auto] items-center gap-[5px] rounded-sm px-[5px] text-control text-foreground-tertiary outline-none transition-hover hover:bg-surface-active hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
    >
      <Icon aria-hidden className="h-3 w-3 shrink-0 text-icon group-hover/chip:text-foreground" />
      <span className="min-w-0 truncate">{link.label}</span>
    </LinkTarget>
  );
}

/** One link in an open entry or recording, with its service or folder at the end. */
export function LinkRow({ link }: { link: DayLink }) {
  const Icon = linkIcon(link);
  return (
    <LinkTarget
      link={link}
      className="group/link flex h-6 w-full items-center gap-1.5 rounded-sm px-1.5 text-left text-control text-foreground-secondary outline-none transition-hover hover:bg-surface-active hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-icon group-hover/link:text-foreground" />
      <span className="min-w-0 flex-1 truncate">{link.label}</span>
      <span className="shrink-0 text-2xs text-foreground-tertiary">
        {link.external ? serviceName(link.target) : folderName(link)}
      </span>
    </LinkTarget>
  );
}

export function LinkList({ links }: { links: readonly DayLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="-ml-1.5 flex flex-col">
      {links.map((link, index) => (
        <LinkRow key={`${index}:${link.target}`} link={link} />
      ))}
    </div>
  );
}
