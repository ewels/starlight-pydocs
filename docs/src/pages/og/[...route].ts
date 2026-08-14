import { getCollection } from 'astro:content';
import { OGImageRoute } from 'astro-og-canvas';
import sharp from 'sharp';

// CanvasKit only decodes bitmaps, so the SVG logotype is rasterised once per
// build rather than checked in as a second copy that could drift.
const logo = 'node_modules/.astro/og-logotype.png';
// The high density renders the SVG well above the target width, so the fine
// detail of the mark survives the downscale instead of aliasing.
await sharp('src/assets/logotype-dark.svg', { density: 288 }).resize({ width: 960 }).png().toFile(logo);

const entries = await getCollection('docs');

// ponytail: content collection pages only. The generated API reference pages are
// injected routes this module cannot enumerate, so they fall back to the site
// card in `src/components/Head.astro`.
export const { getStaticPaths, GET } = await OGImageRoute({
  pages: Object.fromEntries(entries.map((entry) => [entry.id, entry.data])),

  getImageOptions: (_path, page) => ({
    title: page.title,
    description: page.description ?? '',
    logo: { path: logo, size: [960] },
    bgGradient: [
      [27, 31, 42],
      [42, 51, 78],
    ],
    border: { color: [242, 198, 65], width: 16, side: 'inline-start' },
    padding: 60,
    font: {
      // Michroma, as in the logotype and the page titles. It is wide, so the
      // title is smaller here than the package default of 70.
      title: { color: [244, 245, 248], families: ['Michroma', 'Noto Sans'], size: 58, lineHeight: 1.3 },
      description: { color: [170, 178, 196] },
    },
    // CanvasKit has no fonts of its own. Fetched once per machine and cached in
    // `node_modules/.astro-og-canvas`; the second is the package default.
    fonts: [
      'https://api.fontsource.org/v1/fonts/michroma/latin-400-normal.ttf',
      'https://api.fontsource.org/v1/fonts/noto-sans/latin-400-normal.ttf',
    ],
  }),
});
