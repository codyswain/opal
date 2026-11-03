import { describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import type { Tree } from '@lezer/common';
import { GFM, parser as markdownParser } from '@lezer/markdown';
import { parseMarkdown } from '@/main/fs/MarkdownDocumentService';
import { MATH_NODES, mathSyntax } from '@/renderer/features/disk-explorer/components/editor/math';
import { linkMarkStyle } from '@/renderer/features/disk-explorer/components/editor/livePreview';
import { wikiLinkSyntax } from '@/renderer/features/disk-explorer/components/editor/wikiLinks';
import { openedLine, vaultFiles } from './censusHelpers';

/**
 * What math parsing changes in the vault's syntax trees. Each note is parsed
 * with and without math. Outside the formulas, every node keeps its type and
 * place, except paragraphs, whose edges may move where a display block now
 * splits them. It prints every note with any other difference, and the
 * notes that gain math. Read-only.
 *
 *   OPAL_CENSUS_ROOT=/path/to/vault npx vitest run src/tests/fidelity/mathParseDiff.test.ts
 */
const ROOT = process.env.OPAL_CENSUS_ROOT;

const base = markdownParser.configure([GFM, wikiLinkSyntax, linkMarkStyle]);
const withMath = base.configure([mathSyntax]);

interface Range { from: number; to: number }

function nodesOf(tree: Tree): { name: string; from: number; to: number }[] {
  const nodes: { name: string; from: number; to: number }[] = [];
  tree.iterate({ enter: (ref) => { nodes.push({ name: ref.name, from: ref.from, to: ref.to }); } });
  return nodes;
}

const CONTAINERS = new Set(['Blockquote', 'BulletList', 'OrderedList', 'ListItem']);

/** The line number of each offset, from the line starts of `body`. */
function lineNumbers(body: string): (at: number) => number {
  const starts = [0];
  for (let at = body.indexOf('\n'); at !== -1; at = body.indexOf('\n', at + 1)) starts.push(at + 1);
  return (at) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= at) low = mid; else high = mid - 1;
    }
    return low;
  };
}

/**
 * Node keys outside the formulas. Left out: nodes inside or across a
 * formula, paragraphs and hard breaks on the lines next to a display block,
 * which now ends or starts them, and the end of a list or quote that holds
 * one, since a block ends the lazy lines after it.
 */
function outside(tree: Tree, math: readonly Range[], blocks: readonly Range[], body: string): Set<string> {
  const keys = new Set<string>();
  const line = lineNumbers(body);
  const nextToBlock = (node: Range) => blocks.some((block) => {
    const first = line(block.from);
    const last = line(Math.max(block.from, block.to - 1));
    return (line(node.from) <= last + 1 && line(Math.max(node.from, node.to - 1)) >= first - 1);
  });
  for (const node of nodesOf(tree)) {
    if (MATH_NODES.has(node.name) || node.name === 'MathMark' || node.name === 'MathText') continue;
    const touches = math.some((range) => node.from < range.to && node.to > range.from && !(node.from <= range.from && node.to >= range.to));
    if (touches) continue;
    if ((node.name === 'Paragraph' || node.name === 'HardBreak') && nextToBlock(node)) continue;
    const holdsBlock = CONTAINERS.has(node.name) && blocks.some((block) => node.from <= block.from && node.to >= block.to);
    const to = holdsBlock ? '' : node.to;
    keys.add(`${node.name} ${node.from}-${to} ${JSON.stringify(body.slice(node.from, Math.min(node.to, node.from + 30)))}`);
  }
  return keys;
}

describe.skipIf(!ROOT)('math parse diff census', () => {
  it('changes nothing outside the formulas but paragraph edges at display blocks', async () => {
    const vault = await vaultFiles(ROOT as string);
    const differing: string[] = [];
    const gained: { file: string; inline: number; display: number; block: number }[] = [];
    let opened = 0;
    for (const file of vault.found) {
      let body: string;
      try {
        body = parseMarkdown(await readFile(file)).body;
      } catch {
        continue;
      }
      opened += 1;
      if (!/\$|\\\(|\\\[/.test(body)) continue;
      const mathTree = withMath.parse(body);
      const math = nodesOf(mathTree).filter((node) => MATH_NODES.has(node.name));
      if (math.length === 0) continue;
      gained.push({
        file: path.relative(ROOT as string, file),
        inline: math.filter((node) => node.name === 'InlineMath').length,
        display: math.filter((node) => node.name === 'DisplayMath').length,
        block: math.filter((node) => node.name === 'BlockMath').length,
      });
      const blocks = math.filter((node) => node.name === 'BlockMath');
      const before = outside(base.parse(body), math, blocks, body);
      const after = outside(mathTree, math, blocks, body);
      const lost = [...before].filter((key) => !after.has(key));
      const added = [...after].filter((key) => !before.has(key));
      if (lost.length > 0 || added.length > 0) {
        differing.push(`${path.relative(ROOT as string, file)}\n    lost: ${lost.slice(0, 4).join(' | ')}\n    added: ${added.slice(0, 4).join(' | ')}`);
      }
    }
    const formulas = gained.reduce((sum, note) => sum + note.inline + note.display + note.block, 0);
    console.info(openedLine('math parse diff', opened, vault));
    console.info(`[math parse diff] ${gained.length} notes gain math: ${formulas} formulas (${gained.reduce((s, n) => s + n.inline, 0)} inline, ${gained.reduce((s, n) => s + n.display, 0)} display in a line, ${gained.reduce((s, n) => s + n.block, 0)} blocks); ${differing.length} notes with other differences`);
    console.info(`[math parse diff] notes that gain math:\n  ${gained.map((note) => `${note.file} (${note.inline + note.display + note.block})`).join('\n  ')}`);
    if (differing.length > 0) console.info(`[math parse diff] other differences:\n  ${differing.join('\n  ')}`);
    expect(differing).toEqual([]);
  }, 600_000);
});
