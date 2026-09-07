import React from 'react';
import { File, FileText, Film, Folder, Image as ImageIcon, Music } from 'lucide-react';
import type { FileKind } from '@/common/fileKind';

const ICONS: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  directory: Folder, image: ImageIcon, markdown: FileText, text: FileText, pdf: File, video: Film, audio: Music, other: File,
};

/** A hint of colour per kind, the way editors tint file icons; muted enough to stay quiet in a strip. */
const TINTS: Record<FileKind, string> = {
  directory: 'text-amber-500', image: 'text-violet-500', markdown: 'text-sky-500', text: 'text-slate-400',
  pdf: 'text-rose-500', video: 'text-fuchsia-500', audio: 'text-emerald-500', other: 'text-slate-400',
};

export const FileKindIcon: React.FC<{ kind: FileKind; className?: string; tinted?: boolean }> = ({ kind, className = 'h-3.5 w-3.5', tinted = true }) => {
  const Icon = ICONS[kind] ?? File;
  return <Icon aria-hidden className={`${className} shrink-0 ${tinted ? TINTS[kind] : ''}`} />;
};
