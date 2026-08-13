import { inflateSync } from 'node:zlib';

import { expect, test } from '@playwright/test';

interface SymbolsPayload {
  package: string;
  generated: string;
  symbols: { path: string; kind: string; page: string; anchor: string; brief: string }[];
}

test('symbols.json serves the search index for each package', async ({ request }) => {
  const response = await request.get('api/demopkg/symbols.json');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/json');

  const payload = (await response.json()) as SymbolsPayload;
  expect(payload.package).toBe('demopkg');
  expect(Number.isNaN(Date.parse(payload.generated))).toBe(false);
  expect(payload.symbols.length).toBeGreaterThan(20);

  const generate = payload.symbols.find((symbol) => symbol.path === 'demopkg.Report.generate');
  expect(generate).toEqual({
    path: 'demopkg.Report.generate',
    kind: 'function',
    page: 'api/demopkg',
    anchor: 'demopkg.Report.generate',
    brief: 'Render the report and return the path it was written to.',
  });

  // Every package gets its own index, including the one with no extraction.
  const sphinx = (await (await request.get('api/sphpkg/symbols.json')).json()) as SymbolsPayload;
  expect(sphinx.package).toBe('sphpkg');
  expect(sphinx.symbols.map((symbol) => symbol.path)).toContain('sphpkg.Job.describe');
});

test('objects.inv is a Sphinx v2 inventory other sites can consume', async ({ request }) => {
  const response = await request.get('api/demopkg/objects.inv');
  expect(response.status()).toBe(200);

  const payload = await response.body();
  const text = payload.toString('latin1');
  expect(text.split('\n')[0]).toBe('# Sphinx inventory version 2');

  // Four header lines, then a zlib stream of one line per object.
  let offset = 0;
  for (let line = 0; line < 4; line += 1) {
    offset = text.indexOf('\n', offset) + 1;
  }
  const entries = inflateSync(payload.subarray(offset)).toString('utf8').trim().split('\n');

  expect(entries.length).toBeGreaterThan(20);
  expect(entries).toContain('demopkg.report.Report py:class 1 report/#$ -');
  expect(entries).toContain('demopkg.report.Report.generate py:method 1 report/#$ -');
  expect(entries).toContain('demopkg py:module 1  -');
});

test('llms.txt renders the whole API surface as Markdown', async ({ request }) => {
  const response = await request.get('api/demopkg/llms.txt');
  expect(response.status()).toBe(200);
  // The route sets `text/markdown`, but these pages are prerendered: a static
  // host (this preview server included) serves the file by extension instead.
  expect(response.headers()['content-type']).toContain('text/plain');

  const text = await response.text();
  expect(text.startsWith('# demopkg')).toBe(true);
  expect(text).toContain('Rendered pages: https://ewels.github.io/starlight-pydocs/api/demopkg/');
  expect(text).toContain('## demopkg.report.Report');
  expect(text).toContain('```python\nclass Report(BaseReport)\n```');
  expect(text).toContain(
    '```python\ndef generate(*sections: str, title: str | None = None, ' +
      'timeout: float = DEFAULT_TIMEOUT, **options: Any) -> pathlib.Path\n```',
  );
  expect(text).toContain('[View source](https://github.com/ewels/starlight-pydocs/blob/main/');

  // The pre-generated-dump package publishes the same artefact.
  const sphinx = await (await request.get('api/sphpkg/llms.txt')).text();
  expect(sphinx.startsWith('# sphpkg')).toBe(true);
  expect(sphinx).toContain('## sphpkg.submit');
});
