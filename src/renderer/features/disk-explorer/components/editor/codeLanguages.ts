import { StreamLanguage, type StreamParser } from '@codemirror/language';
import type { Parser } from '@lezer/common';

/*
 * The languages a fenced code block is highlighted in: a short list, each
 * loaded the first time a fence names it. A fence's info string is matched
 * by its first word, in any case, against each language's names. Plain
 * words (`text`, `output`) and unknown ones (`awk`) get no colour; unknown
 * ones keep their label as written. Nothing here rewrites the info string.
 */

export interface CodeLanguage {
  /** The word Opal writes when a language is picked. */
  id: string;
  label: string;
  /** Names a fence may use, lower case, `id` first. */
  names: readonly string[];
  load: () => Promise<Parser>;
}

const stream = (parser: StreamParser<unknown>): Parser => StreamLanguage.define(parser).parser;

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: 'js', label: 'JavaScript', names: ['js', 'javascript', 'mjs', 'cjs', 'node'], load: async () => (await import('@codemirror/lang-javascript')).javascriptLanguage.parser },
  { id: 'jsx', label: 'JSX', names: ['jsx'], load: async () => (await import('@codemirror/lang-javascript')).jsxLanguage.parser },
  { id: 'ts', label: 'TypeScript', names: ['ts', 'typescript', 'mts', 'cts'], load: async () => (await import('@codemirror/lang-javascript')).typescriptLanguage.parser },
  { id: 'tsx', label: 'TSX', names: ['tsx'], load: async () => (await import('@codemirror/lang-javascript')).tsxLanguage.parser },
  { id: 'css', label: 'CSS', names: ['css'], load: async () => (await import('@codemirror/lang-css')).cssLanguage.parser },
  { id: 'html', label: 'HTML', names: ['html', 'htm', 'xhtml'], load: async () => (await import('@codemirror/lang-html')).htmlLanguage.parser },
  { id: 'markdown', label: 'Markdown', names: ['markdown', 'md', 'mdo'], load: async () => (await import('@codemirror/lang-markdown')).markdownLanguage.parser },
  { id: 'json', label: 'JSON', names: ['json', 'jsonc', 'json5', 'jsonl', 'geojson'], load: async () => (await import('@codemirror/lang-json')).jsonLanguage.parser },
  { id: 'python', label: 'Python', names: ['python', 'py', 'python3', 'py3'], load: async () => (await import('@codemirror/lang-python')).pythonLanguage.parser },
  { id: 'sql', label: 'SQL', names: ['sql', 'postgres', 'postgresql', 'psql', 'plpgsql', 'mysql', 'sqlite'], load: async () => (await import('@codemirror/lang-sql')).PostgreSQL.language.parser },
  { id: 'yaml', label: 'YAML', names: ['yaml', 'yml'], load: async () => (await import('@codemirror/lang-yaml')).yamlLanguage.parser },
  { id: 'sh', label: 'Shell', names: ['sh', 'bash', 'shell', 'zsh', 'shellscript'], load: async () => stream((await import('@codemirror/legacy-modes/mode/shell')).shell) },
  { id: 'diff', label: 'Diff', names: ['diff', 'patch'], load: async () => stream((await import('@codemirror/legacy-modes/mode/diff')).diff) },
  { id: 'c', label: 'C', names: ['c', 'h'], load: async () => stream((await import('@codemirror/legacy-modes/mode/clike')).c) },
  { id: 'cpp', label: 'C++', names: ['cpp', 'c++', 'cc', 'cxx', 'hpp'], load: async () => stream((await import('@codemirror/legacy-modes/mode/clike')).cpp) },
  { id: 'csharp', label: 'C#', names: ['csharp', 'cs', 'c#'], load: async () => stream((await import('@codemirror/legacy-modes/mode/clike')).csharp) },
  { id: 'java', label: 'Java', names: ['java'], load: async () => stream((await import('@codemirror/legacy-modes/mode/clike')).java) },
  { id: 'kotlin', label: 'Kotlin', names: ['kotlin', 'kt', 'kts'], load: async () => stream((await import('@codemirror/legacy-modes/mode/clike')).kotlin) },
  { id: 'go', label: 'Go', names: ['go', 'golang'], load: async () => stream((await import('@codemirror/legacy-modes/mode/go')).go) },
  { id: 'rust', label: 'Rust', names: ['rust', 'rs'], load: async () => stream((await import('@codemirror/legacy-modes/mode/rust')).rust) },
  { id: 'swift', label: 'Swift', names: ['swift'], load: async () => stream((await import('@codemirror/legacy-modes/mode/swift')).swift) },
  { id: 'ruby', label: 'Ruby', names: ['ruby', 'rb'], load: async () => stream((await import('@codemirror/legacy-modes/mode/ruby')).ruby) },
  { id: 'lua', label: 'Lua', names: ['lua'], load: async () => stream((await import('@codemirror/legacy-modes/mode/lua')).lua) },
  { id: 'toml', label: 'TOML', names: ['toml'], load: async () => stream((await import('@codemirror/legacy-modes/mode/toml')).toml) },
  { id: 'xml', label: 'XML', names: ['xml', 'svg', 'plist'], load: async () => stream((await import('@codemirror/legacy-modes/mode/xml')).xml) },
  { id: 'dockerfile', label: 'Dockerfile', names: ['dockerfile', 'docker'], load: async () => stream((await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile) },
];

/**
 * The options a language search shows, best first: an exact name or label,
 * then a name or label that starts with the query, then a label that holds
 * it. So "c" picks C and "java" picks Java before JavaScript.
 */
export function matchLanguages<T extends { label: string; names: readonly string[] }>(options: readonly T[], query: string): T[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [...options];
  const rank = (option: T) => {
    const words = [option.label.toLowerCase(), ...option.names];
    if (words.includes(wanted)) return 0;
    if (words.some((word) => word.startsWith(wanted))) return 1;
    return option.label.toLowerCase().includes(wanted) ? 2 : 3;
  };
  return options.map((option) => ({ option, rank: rank(option) })).filter(({ rank: at }) => at < 3).sort((a, b) => a.rank - b.rank).map(({ option }) => option);
}

// Words that mean "no language": the first ones read as Plain text, the rest keep a label.
const QUIET = new Set(['', 'text', 'txt', 'plaintext', 'plain']);
const PLAIN_LABELS: Record<string, string> = { output: 'Output', console: 'Console', log: 'Log' };

/** Fences drawn as something other than code: diagrams, and math in its own PR. */
const LABELS: Record<string, string> = { mermaid: 'Mermaid', flowchart: 'Flowchart', math: 'Math', latex: 'LaTeX', tex: 'TeX' };

const byName = new Map(CODE_LANGUAGES.flatMap((language) => language.names.map((name) => [name, language] as const)));

export interface FenceLanguage {
  /** The info string's first word as written, or "". */
  word: string;
  /** The language whose parser colours the code, or null for plain code. */
  language: CodeLanguage | null;
  label: string;
  /** "Plain text": a fence with no language, whose label shows only on hover or with the caret in the block. */
  quiet: boolean;
}

/** The first word of an info string: `ts title="x"` gives `ts`, Pandoc's `{.python}` gives `python`. */
export function infoWord(info: string): string {
  const trimmed = info.trim().replace(/^\{\s*\.?/, '');
  return /^[^\s{},]*/.exec(trimmed)?.[0] ?? '';
}

/** What a fence's info string names. */
export function fenceLanguage(info: string): FenceLanguage {
  const word = infoWord(info);
  const key = word.toLowerCase();
  if (QUIET.has(key)) return { word, language: null, label: 'Plain text', quiet: true };
  const language = byName.get(key) ?? null;
  if (language) return { word, language, label: language.label, quiet: false };
  return { word, language: null, label: PLAIN_LABELS[key] ?? LABELS[key] ?? word, quiet: false };
}

const loaded = new Map<string, Parser>();
const loading = new Map<string, Promise<Parser>>();
const listeners = new Set<() => void>();

/** Loads a language's parser, once. Every listener hears when it is ready. */
export function loadLanguage(language: CodeLanguage): Promise<Parser> {
  const known = loading.get(language.id);
  if (known) return known;
  const promise = language.load().then((parser) => {
    loaded.set(language.id, parser);
    for (const listener of [...listeners]) listener();
    return parser;
  });
  loading.set(language.id, promise);
  promise.catch(() => loading.delete(language.id));
  return promise;
}

/** The language's parser when it has loaded; otherwise starts loading it and gives null. */
export function parserFor(language: CodeLanguage): Parser | null {
  const parser = loaded.get(language.id);
  if (parser) return parser;
  void loadLanguage(language).catch(() => undefined);
  return null;
}

/** Whether a language's parser has loaded. */
export function hasLoaded(language: CodeLanguage): boolean {
  return loaded.has(language.id);
}

/** Calls `listener` whenever a language finishes loading, until the returned function is called. */
export function onLanguageLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Loads every language, for tests and the census, so highlighting is synchronous. */
export async function loadAllLanguages(): Promise<void> {
  await Promise.all(CODE_LANGUAGES.map(loadLanguage));
}
