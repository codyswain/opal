import type { EditorView } from '@codemirror/view';
import { toast } from 'sonner';
import { isFsPathAtOrBelow } from '@/common/fsPaths';
import { openPathLink, pageContext } from './wikiLinks';

/*
 * Where a link with a scheme goes. Links to vault files open in Opal tabs,
 * whatever app wrote them: `opal://open?path=`, Obsidian's
 * `obsidian://open?file=`, the hub's `/o/` links and `file://` URLs inside
 * an opened folder. Web pages and mail go to the browser and mail app, and
 * Linear and Slack links to their apps, through the main process's
 * allowlist. A file outside the vault, or any other scheme, opens nothing
 * and says so.
 */

export type LinkRoute =
  | { kind: 'external'; url: string }
  | { kind: 'vault'; target: string }
  | { kind: 'outside'; path: string }
  | { kind: 'refused'; scheme: string };

// Schemes the main process hands to the system: web, mail, and the Linear and Slack apps.
const EXTERNAL = new Set(['http:', 'https:', 'mailto:', 'linear:', 'slack:']);

const decode = (text: string) => {
  try { return decodeURIComponent(text); } catch { return text; }
};

/** Where `href` goes, given the opened folders. */
export function routeLink(href: string, roots: readonly string[]): LinkRoute {
  let url: URL;
  try { url = new URL(href); } catch { return { kind: 'refused', scheme: '' }; }
  const scheme = url.protocol.toLowerCase();
  if (scheme === 'opal:') {
    const path = url.searchParams.get('path');
    return path ? { kind: 'vault', target: path } : { kind: 'refused', scheme };
  }
  if (scheme === 'obsidian:') {
    const target = url.searchParams.get('file') ?? url.searchParams.get('path');
    return target ? { kind: 'vault', target } : { kind: 'refused', scheme };
  }
  if (scheme === 'file:') {
    const path = decode(url.pathname);
    return roots.some((root) => isFsPathAtOrBelow(root, path)) ? { kind: 'vault', target: path } : { kind: 'outside', path };
  }
  // The hub serves vault files at /o/<path> over Tailscale.
  if ((scheme === 'https:' || scheme === 'http:') && url.hostname.endsWith('.ts.net') && url.pathname.startsWith('/o/')) {
    return { kind: 'vault', target: decode(url.pathname.slice(3)) };
  }
  if (EXTERNAL.has(scheme)) return { kind: 'external', url: href };
  return { kind: 'refused', scheme };
}

/** Opens a vault path, absolute or from the vault's top, in an Opal tab; never creates a note. */
async function openVaultPath(view: EditorView, target: string, newTab: boolean): Promise<void> {
  if (target.startsWith('/')) {
    await openPathLink(view, target, newTab);
    return;
  }
  const { path, openNote } = view.state.facet(pageContext);
  const response = await window.markdownAPI.resolveLinks(path, [target]).catch(() => null);
  const resolved = response?.success ? response.data[target] : null;
  if (resolved) openNote(resolved, newTab);
  else toast.error(`Could not find ${target}.`);
}

/** Follows a link with a scheme from the page. Web, mail and app links open while the click still counts as one. */
export async function followLink(view: EditorView, href: string, newTab: boolean): Promise<void> {
  let route = routeLink(href, []);
  if (route.kind === 'outside') {
    const roots = await window.diskAPI.listRoots().then((result) => (result.success ? result.data : []), () => []);
    route = routeLink(href, roots);
  }
  if (route.kind === 'external') window.open(route.url, '_blank');
  else if (route.kind === 'vault') await openVaultPath(view, route.target, newTab);
  else if (route.kind === 'outside') toast('Outside the vault');
  else toast("Opal doesn't open these links");
}
