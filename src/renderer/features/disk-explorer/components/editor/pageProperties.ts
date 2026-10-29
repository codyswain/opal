import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { basenameFsPath } from '@/common/fsPaths';
import type { MarkdownProperties } from '@/types/markdown';
import { openWikiLink, parseWikiTarget } from './wikiLinks';

/** Shows the properties block with these facts, or hides it with null. */
export const setPageProperties = StateEffect.define<MarkdownProperties | null>();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const twoDigits = (value: number) => String(value).padStart(2, '0');

/** "Oct 28, 2026 at 06:38" in local time, or "Oct 28, 2026" when only the day is known. */
export function formatFileTime(ms: number, dayOnly = false): string {
  const at = new Date(ms);
  const day = `${MONTHS[at.getMonth()]} ${at.getDate()}, ${at.getFullYear()}`;
  return dayOnly ? day : `${day} at ${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
}

/** "1 byte", "41 bytes", "12.4 KB", "3.1 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const WIKI_VALUE = /^\[\[([^[\]]+)\]\]$/;

/** One value: plain text, or a button that follows it when the whole value is a wiki link. */
function valueNode(view: EditorView, value: string): Node {
  const match = WIKI_VALUE.exec(value);
  const link = match && parseWikiTarget(match[1]);
  if (!match || !link?.target) return document.createTextNode(value);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cm-md-properties-link';
  button.textContent = link.aliasAt === null ? basenameFsPath(link.target) : match[1].slice(link.aliasAt).trim();
  button.title = `Opens ${link.target}`;
  button.addEventListener('click', () => { void openWikiLink(view, link.target); });
  return button;
}

function list(rows: [string, (string | Node)[] | null][], className: string): HTMLDListElement {
  const dl = document.createElement('dl');
  dl.className = className;
  for (const [key, values] of rows) {
    const term = document.createElement('dt');
    term.textContent = key;
    term.title = key;
    const detail = document.createElement('dd');
    if (!values || values.length === 0) {
      detail.className = 'cm-md-properties-empty';
      detail.textContent = 'Empty';
    } else {
      values.forEach((value, index) => {
        if (index > 0) detail.append(', ');
        detail.append(value);
      });
    }
    dl.append(term, detail);
  }
  return dl;
}

/**
 * The page's frontmatter, then facts about its file, under the inline
 * title. Read-only: Opal never writes properties from here.
 */
class PagePropertiesWidget extends WidgetType {
  private readonly key: string;

  constructor(readonly facts: MarkdownProperties) {
    super();
    this.key = JSON.stringify(facts);
  }

  eq(other: PagePropertiesWidget) { return other.key === this.key; }

  toDOM(view: EditorView) {
    const { facts } = this;
    const frame = document.createElement('div');
    frame.className = 'cm-md-properties';
    const block = document.createElement('section');
    block.className = 'cm-md-properties-block';
    block.tabIndex = -1;
    block.dataset.pageProperties = '';
    block.setAttribute('aria-label', `Properties of ${basenameFsPath(facts.path)}`);
    if (facts.properties.length > 0) {
      block.append(list(facts.properties.map(({ key, values }) => [key, values.map((value) => valueNode(view, value))]), 'cm-md-properties-list'));
    }
    // The word count is already in the footer, so the block leaves it out.
    block.append(list([
      ['Path', [facts.relativePath]],
      ...(facts.created === null ? [] : [['Created', [formatFileTime(facts.created.ms, facts.created.dayOnly)]] as [string, string[]]]),
      ['Modified', [formatFileTime(facts.modifiedMs)]],
      ['Size', [formatFileSize(facts.size)]],
    ], 'cm-md-properties-list cm-md-properties-file'));
    frame.append(block);
    return frame;
  }
}

/**
 * The block's place in the page: a block widget at the top, after the inline
 * title, which sits at side -1. Each page's editor holds its own facts.
 */
export const pageProperties = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setPageProperties)) continue;
      decorations = effect.value
        ? Decoration.set([Decoration.widget({ widget: new PagePropertiesWidget(effect.value), block: true, side: 0 }).range(0)])
        : Decoration.none;
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
