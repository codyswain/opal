import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { DetailPane } from '@/renderer/features/disk-explorer/components/detail/DetailPane';
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
