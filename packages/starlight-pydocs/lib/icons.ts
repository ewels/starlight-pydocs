import { vendoredIcons } from './vendored-icons.ts';

let simpleIcons: Promise<{ paths: Map<string, string>; slug: (title: string) => string }> | undefined;

/** Loaded on the first card that has a source line, because the set is large. */
const loadSimpleIcons = () =>
  (simpleIcons ??= Promise.all([import('simple-icons'), import('simple-icons/sdk')]).then(([icons, sdk]) => ({
    paths: new Map(
      Object.values(icons).flatMap((icon) => (icon && 'slug' in icon ? [[icon.slug, icon.path] as const] : [])),
    ),
    slug: sdk.titleToSlug,
  })));

/**
 * The icon for a hover card's source line, from the project named at its start:
 * "Python 3.14" and "rich_click API reference" name Python and rich_click.
 * Keep the name rule in step with starlight-codeblocks, so a symbol gets the
 * same icon in a code block and in a signature.
 */
export async function sourceIcon(source: string): Promise<{ slug: string; path: string } | undefined> {
  const { paths, slug: toSlug } = await loadSimpleIcons();
  const project = source.replace(/\s+(api\s+)?(documentation|docs|reference)$/i, '').replace(/(\s+v?\d[\w.-]*)+$/, '');
  const slug = toSlug(project);
  const path = paths.get(slug) ?? vendoredIcons[slug];
  return path === undefined ? undefined : { slug, path };
}
