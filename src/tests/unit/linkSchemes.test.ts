import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { toast } from 'sonner';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { followLink, routeLink } from '@/renderer/features/disk-explorer/components/editor/linkSchemes';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const DOC = '/Vault/Notes/Plan.mdo';
const ROOTS = ['/Vault'];

describe('where a link with a scheme goes', () => {
  it('keeps vault links in Opal, whatever app wrote them', () => {
    expect(routeLink('opal://open?path=Library%2Fx%2FPlan.mdo', ROOTS)).toEqual({ kind: 'vault', target: 'Library/x/Plan.mdo' });
    expect(routeLink('obsidian://open?vault=vault&file=Library%2Fx%2FPlan', ROOTS)).toEqual({ kind: 'vault', target: 'Library/x/Plan' });
    expect(routeLink('https://notes.example.ts.net/o/Library/x/My%20Plan.md', ROOTS)).toEqual({ kind: 'vault', target: 'Library/x/My Plan.md' });
    expect(routeLink('file:///Vault/Library/x/a%20b.md', ROOTS)).toEqual({ kind: 'vault', target: '/Vault/Library/x/a b.md' });
  });

  it('sends web, mail, Linear and Slack links out, and refuses the rest', () => {
    expect(routeLink('https://example.com/a', ROOTS)).toEqual({ kind: 'external', url: 'https://example.com/a' });
    expect(routeLink('mailto:a@b.com', ROOTS).kind).toBe('external');
    expect(routeLink('linear://acme/issue/ENG-12', ROOTS).kind).toBe('external');
    expect(routeLink('slack://channel?id=C1', ROOTS).kind).toBe('external');
    expect(routeLink('file:///etc/hosts', ROOTS)).toEqual({ kind: 'outside', path: '/etc/hosts' });
    expect(routeLink('javascript:alert(1)', ROOTS).kind).toBe('refused');
    expect(routeLink('vscode://file/x', ROOTS).kind).toBe('refused');
  });
});

describe('following a link from the page', () => {
  let view: EditorView;
  const openNote = vi.fn();

  beforeEach(() => {
    installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ROOTS })) });
    installMarkdownApi({ [DOC]: '', '/Vault/Library/x/Plan.mdo': '' });
    window.markdownAPI.resolveLinks = vi.fn(async (_page: string, targets: string[]) => ({
      success: true as const,
      data: Object.fromEntries(targets.map((target) => [target, target === 'Library/x/Plan.mdo' ? '/Vault/Library/x/Plan.mdo' : null])),
    })) as typeof window.markdownAPI.resolveLinks;
    view = new EditorView({ parent: document.body, state: EditorState.create({ doc: '', extensions: markdownEditorExtensions(DOC, openNote) }) });
  });

  afterEach(() => {
    view.destroy();
    vi.restoreAllMocks();
    openNote.mockReset();
  });

  it('opens a vault link in a tab, and says so for the rest', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await followLink(view, 'opal://open?path=Library%2Fx%2FPlan.mdo', true);
    expect(openNote).toHaveBeenCalledWith('/Vault/Library/x/Plan.mdo', true);
    await followLink(view, 'slack://channel?id=C1', false);
    expect(open).toHaveBeenCalledWith('slack://channel?id=C1', '_blank');
    await followLink(view, 'file:///etc/hosts', false);
    expect(toast).toHaveBeenCalledWith('Outside the vault');
    await followLink(view, 'vscode://file/x', false);
    expect(toast).toHaveBeenCalledWith("Opal doesn't open these links");
    await followLink(view, 'opal://open?path=Missing.md', false);
    expect(toast.error).toHaveBeenCalledWith('Could not find Missing.md.');
  });
});
