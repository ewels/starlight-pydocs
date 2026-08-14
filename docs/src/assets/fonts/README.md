# Share-card fonts

Two TrueType faces, read from disk by `src/pages/og/[...route].ts` when it draws
the OpenGraph cards.

They are checked in rather than fetched. CanvasKit has no fonts of its own, and
astro-og-canvas caches font downloads only in memory, so every build otherwise
made two requests to `api.fontsource.org`: a deploy that could fail, or quietly
draw cards with no text, whenever that API was unreachable. 64 KB in the
repository buys a build that needs no network.

TTF because CanvasKit decodes TrueType and OpenType only. The `@fontsource`
packages ship `woff`/`woff2`, which it cannot read, so these come from the
Fontsource API instead:

- `michroma-latin-400-normal.ttf` — https://api.fontsource.org/v1/fonts/michroma/latin-400-normal.ttf
- `noto-sans-latin-400-normal.ttf` — https://api.fontsource.org/v1/fonts/noto-sans/latin-400-normal.ttf

Michroma is the face the logotype is outlined in, and the card titles match it.
Noto Sans covers the descriptions and anything Michroma has no glyph for.

## Licence

Both are licensed under the SIL Open Font License 1.1, whose text is in
`OFL.txt`:

- Michroma: Copyright 2011 The Michroma Project Authors
  (https://github.com/googlefonts/Michroma-font)
- Noto Sans: Copyright 2022 The Noto Project Authors
  (https://github.com/notofonts/latin-greek-cyrillic)
