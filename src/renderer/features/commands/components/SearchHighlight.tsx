import React from 'react';

/** Literal matching mirrors the search query; vault text is never interpreted as HTML. */
export function SearchHighlight({ text, query }: { text: string; query: string }) {
  const term = query.trim().slice(0, 200);
  if (!term) return <>{text}</>;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return <>{text.split(new RegExp(`(${escaped})`, 'gi')).map((part, index) =>
    index % 2 ? <mark key={index} className="rounded-sm bg-focus/10 px-0 font-semibold text-foreground">{part}</mark> : part
  )}</>;
}
