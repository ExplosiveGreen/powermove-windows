import { describe, expect, it } from 'vitest';

import { blocksFromMarkdown, inlineRuns, plainText, wordsFromRuns } from './markdown';

describe('inlineRuns', () => {
  it('parses code, bold, italic, and links without leaking markers', () => {
    expect(inlineRuns('run `npm test` then **stop**')).toEqual([
      { text: 'run ' }, { text: 'npm test', c: true }, { text: ' then ' }, { text: 'stop', b: true }
    ]);
    expect(inlineRuns('see [the docs](https://example.com/docs) now')).toEqual([
      { text: 'see ' }, { text: 'the docs', href: 'https://example.com/docs' }, { text: ' now' }
    ]);
    expect(inlineRuns('*soft* and _quiet_')).toEqual([
      { text: 'soft', i: true }, { text: ' and ' }, { text: 'quiet', i: true }
    ]);
  });

  it('keeps snake_case words and unclosed markers as literal text', () => {
    expect(inlineRuns('use file_path here')).toEqual([{ text: 'use file_path here' }]);
    expect(inlineRuns('this is **not closed')).toEqual([{ text: 'this is **not closed' }]);
  });

  it('links bare URLs and drops unsafe link targets', () => {
    expect(inlineRuns('Portrait: https://commons.wikimedia.org/wiki/File:Tim.jpg, CC BY')).toEqual([
      { text: 'Portrait: ' },
      { text: 'https://commons.wikimedia.org/wiki/File:Tim.jpg', href: 'https://commons.wikimedia.org/wiki/File:Tim.jpg' },
      { text: ', CC BY' }
    ]);
    expect(inlineRuns('[x](javascript:alert(1))').some((run) => run.href)).toBe(false);
    const wiki = 'https://commons.wikimedia.org/wiki/File:Tim_Cook_March_2026_(cropped).jpg';
    expect(inlineRuns(`[Commons](${wiki}), CC BY`)).toEqual([{ text: 'Commons', href: wiki }, { text: ', CC BY' }]);
    expect(inlineRuns(`See ${wiki}.`)).toEqual([{ text: 'See ' }, { text: wiki, href: wiki }, { text: '.' }]);
  });

  it('links autolinks, titled links, and images without stray markers', () => {
    expect(inlineRuns('Docs: <https://x.y/a>.')).toEqual([{ text: 'Docs: ' }, { text: 'https://x.y/a', href: 'https://x.y/a' }, { text: '.' }]);
    expect(inlineRuns('[Guide](https://x.y/g "The guide")')).toEqual([{ text: 'Guide', href: 'https://x.y/g' }]);
    expect(inlineRuns('![Frame 12](https://x.y/f.png)')).toEqual([{ text: 'Frame 12', href: 'https://x.y/f.png' }]);
    expect(inlineRuns('![](https://x.y/shots/f.png)')).toEqual([{ text: 'f.png', href: 'https://x.y/shots/f.png' }]);
    // Targets main will not open (mail, local files) stay readable text.
    expect(inlineRuns('[mail](mailto:a@b.c)')).toEqual([{ text: 'mail' }]);
    expect(inlineRuns('[app.ts](/Users/me/app.ts:12)')).toEqual([{ text: 'app.ts' }]);
  });
});

describe('blocksFromMarkdown', () => {
  it('splits paragraphs, headings, lists, quotes, and fences', () => {
    const blocks = blocksFromMarkdown([
      '## Plan', '', 'First line', 'same paragraph', '', '- one', '- two', '1. first', '', '> aside', '', '```ts', 'const a = 1;', '```'
    ].join('\n'));
    expect(blocks.map((block) => block.kind)).toEqual(['h', 'p', 'li', 'li', 'li', 'quote', 'code']);
    expect(plainText(blocks)).toBe('Plan\nFirst line same paragraph\none\ntwo\nfirst\naside\nconst a = 1;');
    expect(blocks[4]).toMatchObject({ kind: 'li', ordinal: 1 });
    expect(blocks[6]).toMatchObject({ kind: 'code', lang: 'ts' });
  });

  it('renders a still-open fence as code so streaming does not flicker', () => {
    const blocks = blocksFromMarkdown('```\nhalf');
    expect(blocks).toEqual([{ kind: 'code', text: 'half' }]);
  });

  it('is safe on empty input', () => {
    expect(blocksFromMarkdown('')).toEqual([]);
    expect(blocksFromMarkdown(undefined as any)).toEqual([]);
  });
});

describe('wordsFromRuns', () => {
  it('splits runs into words with stable keys and keeps links whole', () => {
    const words = wordsFromRuns([{ text: 'a b' }, { text: 'x y', href: 'https://x.y' }]);
    expect(words.map((word) => [word.key, word.text])).toEqual([['0-0', 'a'], ['0-1', ' '], ['0-2', 'b'], ['1', 'x y']]);
  });
});

 it('keeps inline code in one element and handles escaped delimiters', () => {
   expect(wordsFromRuns(inlineRuns('`bun run test`'))).toEqual([{text: 'bun run test', c: true, key: '0'}]);
   expect(inlineRuns('``a `tick` here``')).toEqual([{text: 'a `tick` here', c: true}]);
   expect(inlineRuns(String.raw`\*literal\*`)).toEqual([{text: '*literal*'}]);
 });
