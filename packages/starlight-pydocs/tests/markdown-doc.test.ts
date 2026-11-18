import fs from 'node:fs/promises';

import { beforeAll, describe, expect, test } from 'vitest';

import { renderPackageMarkdown, renderPageMarkdown } from '../lib/markdown-doc.ts';
import { buildModel } from '../lib/model.ts';
import type { PackageModel, PageModel } from '../lib/model.ts';
import type { GriffeDump } from '../lib/types.ts';
import { fixtureModel, modelOptions, testFixturePath } from './helpers.ts';

let demopkg: PackageModel;

function page(model: PackageModel, title: string): PageModel {
  const found = model.pages.find((entry) => entry.title === title);
  if (found === undefined) throw new Error(`no page titled ${title}`);
  return found;
}

beforeAll(async () => {
  demopkg = await fixtureModel('demopkg', {
    sourceLink: {
      template: 'https://github.com/ewels/starlight-pydocs/blob/{ref}/{path}#L{start}-L{end}',
      ref: 'main',
    },
  });
});

describe('renderPageMarkdown', () => {
  test('matches the golden output for the report page', async () => {
    await expect(renderPageMarkdown(page(demopkg, 'demopkg.report'), { includeSource: true })).toMatchFileSnapshot(
      './snapshots/demopkg-report.md',
    );
  });

  test('matches the golden output for the package root page', async () => {
    await expect(renderPageMarkdown(page(demopkg, 'demopkg'))).toMatchFileSnapshot('./snapshots/demopkg-root.md');
  });

  test('headings use dotted paths at the depth the page plan promises', () => {
    const markdown = renderPageMarkdown(page(demopkg, 'demopkg.report'));
    const headings = [...markdown.matchAll(/^(#{1,6}) (.+)$/gm)].map(([, hashes, text]) => ({
      depth: hashes?.length ?? 0,
      text: text ?? '',
    }));

    expect(headings[0]).toEqual({ depth: 1, text: 'demopkg.report' });
    expect(headings.slice(1)).toEqual(
      page(demopkg, 'demopkg.report').headings.map((heading) => ({ depth: heading.depth, text: heading.slug })),
    );
  });

  test('signatures are fenced as python', () => {
    const markdown = renderPageMarkdown(page(demopkg, 'demopkg.report'));
    expect(markdown).toContain(
      '```python\ndef generate(*sections: str, title: str | None = None, timeout: float = DEFAULT_TIMEOUT, **options: Any) -> pathlib.Path\n```',
    );
    expect(markdown).toContain('```python\nclass Report(BaseReport)\n```');
  });

  test('positional-only and keyword-only markers survive', () => {
    expect(renderPageMarkdown(page(demopkg, 'demopkg.report'))).toContain(
      "def generate_report(source, /, name: str, *, fmt: str = 'md') -> Report",
    );
  });

  test('parameters render as a list with types and defaults', () => {
    const markdown = renderPageMarkdown(page(demopkg, 'demopkg.report'));
    expect(markdown).toContain('- `title` (`str | None`) (default: `None`) — Overrides the report title.');
    expect(markdown).toContain('- `*sections` (`str`)');
  });

  test('raises, examples and admonitions each get their own block', () => {
    const markdown = renderPageMarkdown(page(demopkg, 'demopkg.report'));
    expect(markdown).toContain('**Raises**\n\n- `ReportError` — If a requested section does not exist.');
    expect(markdown).toContain('```pycon\n>>> Report("weekly").generate("summary", title="Weekly")');
    expect(markdown).toContain('> **Note**');
  });

  test('provenance and deprecation are stated in words', () => {
    const markdown = renderPageMarkdown(page(demopkg, 'demopkg.report'));
    expect(markdown).toContain('Inherited from: `demopkg.report.BaseReport`');
    expect(markdown).toContain('**Deprecated**: Since 0.3.');
    expect(renderPageMarkdown(page(demopkg, 'demopkg'))).toContain('Re-exported from: `demopkg.report`');
  });

  test('the deprecated admonition is not repeated after the deprecation line', () => {
    const markdown = renderPageMarkdown(page(demopkg, 'demopkg.report'));
    expect(markdown).not.toContain('> **Deprecated**');
  });

  test('submodules are listed rather than inlined', () => {
    const markdown = renderPageMarkdown(page(demopkg, 'demopkg'));
    expect(markdown).toContain('**Modules**\n\n- `demopkg.compat`');
    expect(markdown).not.toContain('# demopkg.compat');
  });

  test('source links appear only when asked for', () => {
    expect(renderPageMarkdown(page(demopkg, 'demopkg.report'), { includeSource: true })).toContain(
      '[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py',
    );
    expect(renderPageMarkdown(page(demopkg, 'demopkg.report'))).not.toContain('[View source]');
  });

  test('labels can be overridden', () => {
    const markdown = renderPageMarkdown(page(demopkg, 'demopkg.report'), {
      labels: { parameters: 'Arguments', bases: 'Extends' },
    });
    expect(markdown).toContain('**Arguments**');
    expect(markdown).toContain('Extends: `demopkg.report.BaseReport`');
    expect(markdown).not.toContain('**Parameters**');
  });

  test('Sphinx roles become code, outside code blocks only', async () => {
    const dump = JSON.parse(await fs.readFile(testFixturePath('synthetic.dump.json'), 'utf8')) as GriffeDump;
    const value = 'Wraps :class:`~click.testing.CliRunner`.\n\n```rst\n:meth:`kept`\n```';
    const own = dump['ovpkg']?.members?.['A']?.members?.['own'];
    if (own === undefined) throw new Error('fixture lost ovpkg.A.own');
    own.docstring = { value, parsed: [{ kind: 'text', value }] };
    const markdown = renderPackageMarkdown(buildModel(dump, modelOptions('ovpkg', { base: 'api/ovpkg' })));
    expect(markdown).toContain('Wraps `CliRunner`.');
    expect(markdown).toContain('```rst\n:meth:`kept`\n```');
  });

  test('never leaves more than one blank line behind', () => {
    for (const entry of demopkg.pages) {
      expect(renderPageMarkdown(entry)).not.toMatch(/\n{3}/);
    }
  });
});

describe('renderPackageMarkdown', () => {
  test('joins every page with a horizontal rule, in navigation order', () => {
    const markdown = renderPackageMarkdown(demopkg);
    const titles = [...markdown.matchAll(/^# (.+)$/gm)].map(([, title]) => title);
    expect(titles).toEqual(demopkg.pages.map((entry) => entry.title));
    expect(markdown.split('\n---\n')).toHaveLength(demopkg.pages.length);
  });

  test('renders the numpy fixture too', async () => {
    const markdown = renderPackageMarkdown(await fixtureModel('numpkg'));
    expect(markdown).toContain('# numpkg');
    expect(markdown).toContain('- `factor` (`float`) (default: `2.0`) — Multiplier applied to both dimensions');
  });

  test('renders the sphinx fixture too', async () => {
    const markdown = renderPackageMarkdown(await fixtureModel('sphpkg'));
    expect(markdown).toContain('def submit(job: Job, *, dry_run: bool = False) -> str');
    expect(markdown).toContain('- `dry_run` (`bool`) (default: `False`) — When true, validate without queueing.');
  });
});
