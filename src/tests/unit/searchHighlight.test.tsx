import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchHighlight } from '@/renderer/features/commands/components/SearchHighlight';

describe('search result highlighting', () => {
  it('marks repeated literal matches without changing case or surrounding text', () => {
    const { container } = render(<SearchHighlight text="C++ plans, then c++ notes" query="c++" />);
    expect(container.textContent).toBe('C++ plans, then c++ notes');
    expect([...container.querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['C++', 'c++']);
  });
  it('renders filenames and snippets as text, including markup and regex syntax', () => {
    const { container } = render(<SearchHighlight text={'<img src=x> [draft] (v2).*'} query="[draft]" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('mark')).toHaveTextContent('[draft]');
    expect(container.textContent).toBe('<img src=x> [draft] (v2).*');
  });
  it('leaves text intact for empty or absent matches', () => {
    const { container, rerender } = render(<SearchHighlight text="Garden notes" query="" />);
    expect(screen.getByText('Garden notes')).toBeVisible();
    expect(container.querySelector('mark')).toBeNull();
    rerender(<SearchHighlight text="Garden notes" query="orchid" />);
    expect(container.textContent).toBe('Garden notes');
    expect(container.querySelector('mark')).toBeNull();
  });
});
