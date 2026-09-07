import { StarterKit } from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { Placeholder } from '@tiptap/extension-placeholder';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Link } from '@tiptap/extension-link';
import { Typography } from '@tiptap/extension-typography';
import { common, createLowlight } from 'lowlight';
import type { Extensions } from '@tiptap/core';

const lowlight = createLowlight(common);

/**
 * A Markdown-shaped extension set: everything here round-trips through
 * tiptap-markdown, so what the editor shows is what the file will hold.
 */
export function markdownExtensions(): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      history: { depth: 200, newGroupDelay: 500 },
    }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' }),
    Markdown.configure({
      html: false,
      tightLists: true,
      bulletListMarker: '-',
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Link.configure({
      openOnClick: false,
      autolink: true,
      validate: (url) => /^(https?:\/\/|mailto:)/.test(url),
    }),
    Typography,
    Placeholder.configure({ placeholder: 'Start writing…', emptyEditorClass: 'is-editor-empty' }),
  ];
}
