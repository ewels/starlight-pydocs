/**
 * Sanitising rendered docstring HTML.
 *
 * Docstring prose is only as trustworthy as the package it was extracted from,
 * and a pre-generated dump (`source: { url }`) may not even come from the site
 * author's own code. The rendered HTML lands in pages via `set:html`, so by
 * default it is filtered through an allowlist before it reaches the sidecar:
 * markup markdown legitimately produces survives (including Shiki's and
 * Expressive Code's inline-styled output and GFM task-list checkboxes), while
 * scripts, event handlers, frames, forms and `javascript:` URLs do not.
 *
 * The allowlist is deliberately generous because docstrings routinely embed
 * hand-written HTML; `sanitizeDocstrings: false` turns the filter off entirely
 * for sites that need markup beyond it and trust every documented package.
 *
 * Runs only at `astro:config:done`, in Node: nothing here is bundled for the
 * browser, and the package's one runtime dependency stays out of the SSR graph.
 */

import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  // Prose and sectioning.
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'bdi',
  'bdo',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'input',
  'ins',
  'kbd',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'picture',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'section',
  'small',
  'source',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
  'wbr',
  // Expressive Code's copy button; inert without its script, harmless with it.
  'button',
  // Inline icons. No <use>: its href can reach outside the allowlist.
  'svg',
  'path',
  'g',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'rect',
  'defs',
  'symbol',
  'title',
  'desc',
];

const SVG_PRESENTATION = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'fill-rule',
  'clip-rule',
  'opacity',
  'transform',
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    // `style` carries Shiki's per-token colours and Expressive Code's wrapper
    // variables; CSS cannot execute script, so it passes verbatim (see
    // `parseStyleAttributes` below).
    '*': [
      'class',
      'style',
      'id',
      'title',
      'dir',
      'lang',
      'align',
      'role',
      'tabindex',
      'hidden',
      'translate',
      'aria-*',
      'data-*',
    ],
    a: ['href', 'name', 'rel', 'target'],
    img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding'],
    source: ['src', 'srcset', 'sizes', 'type', 'media'],
    blockquote: ['cite'],
    q: ['cite'],
    del: ['cite', 'datetime'],
    ins: ['cite', 'datetime'],
    time: ['datetime'],
    details: ['open'],
    // GFM task-list checkboxes.
    input: ['type', 'checked', 'disabled', 'readonly'],
    ol: ['start', 'reversed', 'type'],
    li: ['value'],
    td: ['colspan', 'rowspan', 'headers'],
    th: ['colspan', 'rowspan', 'headers', 'scope'],
    col: ['span'],
    colgroup: ['span'],
    button: ['type'],
    // Lowercase spellings: the parser lowercases attribute names, and the
    // browser's SVG-in-HTML adjustment table restores `viewBox` casing.
    svg: ['viewbox', 'xmlns', 'width', 'height', 'preserveaspectratio', ...SVG_PRESENTATION],
    path: ['d', 'pathlength', ...SVG_PRESENTATION],
    g: [...SVG_PRESENTATION],
    circle: ['cx', 'cy', 'r', ...SVG_PRESENTATION],
    ellipse: ['cx', 'cy', 'rx', 'ry', ...SVG_PRESENTATION],
    line: ['x1', 'y1', 'x2', 'y2', ...SVG_PRESENTATION],
    polygon: ['points', ...SVG_PRESENTATION],
    polyline: ['points', ...SVG_PRESENTATION],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', ...SVG_PRESENTATION],
  },
  // Applies to href, src and cite. `data:` images render but never execute;
  // links get no `data:`, and nothing anywhere gets `javascript:`.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'], source: ['http', 'https', 'data'] },
  allowProtocolRelative: true,
  // Keep `style` attributes byte-for-byte: postcss reserialisation garbles the
  // `--shiki-*` custom properties dual-theme highlighting depends on.
  parseStyleAttributes: false,
  // `input` is allowed for GFM task-list checkboxes and nothing else.
  exclusiveFilter: (frame) => frame.tag === 'input' && frame.attribs['type'] !== 'checkbox',
};

/** Rendered docstring HTML with everything outside the allowlist removed. */
export function sanitizeDocstringHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
