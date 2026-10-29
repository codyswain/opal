import type { DayLink } from '@/types/day';

/*
 * How the sidebar names and orders a day's links. The syntax says the type:
 * wiki links are vault files and markdown links are external.
 */

export type VaultLinkKind = 'chat' | 'recording' | 'person' | 'note';

/** What a vault link points at, by its folder. */
export function vaultLinkKind(link: Pick<DayLink, 'target' | 'path'>): VaultLinkKind {
  const where = link.path ?? link.target;
  if (/(?:^|\/)Library\/chats\//.test(where)) return 'chat';
  if (/(?:^|\/)(?:Library\/recordings|Inbox\/Recordings)\//.test(where)) return 'recording';
  if (/(?:^|\/)Library\/people\//.test(where)) return 'person';
  return 'note';
}

const SERVICES: [RegExp, string][] = [
  [/linear\.app/, 'Linear'],
  [/github\.com/, 'GitHub'],
  [/mail\.google\.com/, 'Gmail'],
  [/slack\.com/, 'Slack'],
  [/docs\.google\.com/, 'Google Docs'],
  [/google\.com\/calendar|calendar\.google\.com/, 'Calendar'],
  [/onshape\.com/, 'Onshape'],
  [/notion\.so/, 'Notion'],
];

/** The service an external link goes to, or "Web". */
export function serviceName(url: string): string {
  return SERVICES.find(([pattern]) => pattern.test(url))?.[1] ?? 'Web';
}

export function hostName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'the link';
  }
}

/** The vault file a target names, with ".md" when the target has no extension. */
export function targetFile(target: string): string {
  const file = target.split('#')[0];
  return /\.[a-z0-9]+$/i.test(file) ? file : `${file}.md`;
}

/** The name of the folder a vault link's file is in. */
export function folderName(link: Pick<DayLink, 'target' | 'path'>): string {
  const parts = (link.path ?? link.target.split('#')[0]).split('/');
  return parts.length > 1 ? parts[parts.length - 2] : 'vault';
}

/** Notes and issues first, other external links next, the source chat last; ties keep the written order. */
export function sortDayLinks(links: readonly DayLink[]): DayLink[] {
  const rank = (link: DayLink) =>
    link.external ? (serviceName(link.target) === 'Linear' ? 0 : 1) : vaultLinkKind(link) === 'chat' ? 2 : 0;
  return links
    .map((link, index) => ({ link, index }))
    .sort((a, b) => rank(a.link) - rank(b.link) || a.index - b.index)
    .map(({ link }) => link);
}

export function linkTitle(link: DayLink): string {
  if (link.external) return `Opens ${hostName(link.target)} in the browser`;
  if (!link.path) return `${targetFile(link.target)} is not in the vault`;
  return openTitle(targetFile(link.target));
}

export const openTitle = (file: string) => `Opens ${file} in this tab. Cmd-click opens a new tab.`;
