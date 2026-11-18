import { describe, expect, it } from 'vitest';
import { sourceIcon } from '../lib/icons.ts';

describe('sourceIcon', () => {
  it('finds a Simple Icons logo from the project at the start of the source', async () => {
    expect((await sourceIcon('Python 3.14'))?.slug).toBe('python');
    expect((await sourceIcon('NumPy v2.1 documentation'))?.slug).toBe('numpy');
  });

  it('falls back to the logos vendored for Python projects that Simple Icons lacks', async () => {
    expect((await sourceIcon('Click 8.3.x'))?.slug).toBe('click');
    expect((await sourceIcon('rich_click API reference'))?.path).toMatch(/^M/);
    expect((await sourceIcon('statsmodels 0.15.0 0.15.0 documentation'))?.slug).toBe('statsmodels');
  });

  it('gives no icon for a project with no logo', async () => {
    expect(await sourceIcon('demopkg API reference')).toBeUndefined();
  });
});
