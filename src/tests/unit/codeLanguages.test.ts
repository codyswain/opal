import { describe, expect, it } from 'vitest';
import { CODE_LANGUAGES, fenceLanguage, infoWord, loadAllLanguages } from '@/renderer/features/disk-explorer/components/editor/codeLanguages';

describe('code languages', () => {
  it('match a fence\'s first word in any case, with aliases', () => {
    expect(fenceLanguage('SQL')).toMatchObject({ label: 'SQL', quiet: false });
    expect(fenceLanguage('SQL').language?.id).toBe('sql');
    expect(fenceLanguage('Typescript').language?.label).toBe('TypeScript');
    expect(fenceLanguage('sh').label).toBe('Shell');
    expect(fenceLanguage('bash').label).toBe('Shell');
    expect(fenceLanguage('yml').label).toBe('YAML');
    expect(fenceLanguage('py').label).toBe('Python');
    expect(fenceLanguage('jsonc').label).toBe('JSON');
    expect(fenceLanguage('patch').label).toBe('Diff');
  });

  it('give no language for text, and Plain text shown only on hover for it and for no info at all', () => {
    for (const info of ['', 'text', 'TXT', 'plaintext']) {
      expect(fenceLanguage(info)).toMatchObject({ language: null, label: 'Plain text', quiet: true });
    }
    expect(fenceLanguage('output')).toMatchObject({ language: null, label: 'Output', quiet: false });
  });

  it('label an unknown word as written, with no colour', () => {
    expect(fenceLanguage('awk')).toMatchObject({ language: null, label: 'awk', quiet: false });
    expect(fenceLanguage('Dockerfile')).toMatchObject({ language: null, label: 'Dockerfile' });
    expect(fenceLanguage('mermaid').label).toBe('Mermaid');
  });

  it('read the first word of an info string with attributes', () => {
    expect(infoWord('ts title="x"')).toBe('ts');
    expect(fenceLanguage('ts title="x"').language?.label).toBe('TypeScript');
    expect(infoWord('{.python .numberLines}')).toBe('python');
    expect(infoWord('  js  ')).toBe('js');
  });

  it('load every parser in the list', async () => {
    await loadAllLanguages();
    for (const language of CODE_LANGUAGES) expect(typeof (await language.load()).parse).toBe('function');
  });
});
