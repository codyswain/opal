import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { DetailPane } from '@/renderer/features/disk-explorer/components/detail/DetailPane';
import { stripMarkdownFrontmatter } from '@/renderer/features/disk-explorer/components/detail/markdownFrontmatter';
import { installDiskApi, entry } from '@/tests/helpers/diskApi';

const MD = entry({ path: '/V/note.md', name: 'note.md', kind: 'markdown', size: 42 });
const TXT = entry({ path: '/V/a.ts', name: 'a.ts', kind: 'text', size: 20 });

beforeEach(() => {
  installDiskApi({
    readTextFile: vi.fn(async (p: string) => ({
      success: true as const,
      data: {
        path: p,
        text: p.endsWith('.md') ? '# Title\n\nSome **bold** text.' : 'const x = 1;',
        truncated: false,
        size: 42,
      },
    })),
  });
});

describe('markdown preview', () => {
  it('renders markdown as HTML, not as raw text', async () => {
    render(<DetailPane entry={MD} />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Title')
    );
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.queryByText('# Title')).not.toBeInTheDocument();
  });

  it('requests the file through the guarded IPC channel', async () => {
    render(<DetailPane entry={MD} />);
    await waitFor(() => expect(window.diskAPI.readTextFile).toHaveBeenCalledWith('/V/note.md'));
  });

  it('does not render valid YAML frontmatter as document content', async () => {
    installDiskApi({
      readTextFile: vi.fn(async (p: string) => ({
        success: true as const,
        data: {
          path: p,
          text: '---\ntags:\n  - work\nopal:\n  schema: 1\n  id: 11111111-1111-4111-8111-111111111111\n---\n# Visible title',
          truncated: false,
          size: 120,
        },
      })),
    });
    render(<DetailPane entry={MD} />);

    expect(await screen.findByRole('heading', { name: 'Visible title' })).toBeInTheDocument();
    expect(screen.queryByText(/11111111/)).not.toBeInTheDocument();
    expect(screen.queryByText('tags:')).not.toBeInTheDocument();
  });

  it('strips valid comment-only frontmatter', () => {
    expect(stripMarkdownFrontmatter('---\n# retained metadata comment\n---\n# Body')).toBe('# Body');
  });

  it.each([
    ['aliases', 'value: &shared hello\ntags: [*shared]'],
    ['custom tags', 'other: !secret value'],
    ['malformed tags', 'tags: project'],
    ['malformed annotation', 'annotation: [not, text]'],
    ['malformed identity', 'opal: {schema: 1, id: not-a-uuid}'],
    ['malformed links', 'opal: {schema: 1, id: 11111111-1111-4111-8111-111111111111, links: wrong}'],
  ])('keeps %s frontmatter visible', (_, yaml) => {
    const source = `---\n${yaml}\n---\n# Body`;
    expect(stripMarkdownFrontmatter(source)).toBe(source);
  });

  it('keeps frontmatter over the 64 KiB metadata limit visible', () => {
    const source = `---\nother: ${'x'.repeat(64 * 1024)}\n---\n# Body`;
    expect(stripMarkdownFrontmatter(source)).toBe(source);
  });

  it('keeps unclosed frontmatter visible', () => {
    const source = '---\ntags: [project]\n# Body';
    expect(stripMarkdownFrontmatter(source)).toBe(source);
  });
});

describe('text preview', () => {
  it('renders plain text verbatim', async () => {
    render(<DetailPane entry={TXT} />);
    await waitFor(() => expect(screen.getByTestId('text-preview')).toHaveTextContent('const x = 1;'));
  });

  it('surfaces a read error instead of rendering nothing', async () => {
    installDiskApi({
      readTextFile: vi.fn(async () => ({ success: false as const, error: 'Permission denied' })),
    });

    render(<DetailPane entry={TXT} />);
    await waitFor(() =>
      expect(screen.getByTestId('text-preview-error')).toHaveTextContent('Permission denied')
    );
  });

  it('warns when the file was truncated', async () => {
    installDiskApi({
      readTextFile: vi.fn(async (p: string) => ({
        success: true as const,
        data: { path: p, text: 'x'.repeat(100), truncated: true, size: 9_000_000 },
      })),
    });

    render(<DetailPane entry={TXT} />);
    await waitFor(() => expect(screen.getByTestId('text-preview-truncated')).toBeInTheDocument());
  });
});
