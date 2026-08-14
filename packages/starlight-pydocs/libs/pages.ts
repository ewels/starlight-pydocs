/**
 * The list of generated pages, for site code that needs to know what was
 * injected.
 *
 * Injected routes are invisible to everything that enumerates content
 * collection entries, so a site cannot make per-page share cards, a custom
 * index or a sitemap entry for them without asking. This is that question,
 * answered from the same model the routes render.
 */

import type { PydocsContext } from '../lib/context.ts';
import { getModel } from '../lib/data.ts';

export interface PydocsPageInfo {
  /** Base of the package entry the page belongs to. */
  base: string;
  /**
   * Path of the page within the site, without leading or trailing slashes. It
   * starts with the package's base: `api/demopkg/report`.
   */
  slug: string;
  /** Dotted module path, as the page heading and title use it. */
  title: string;
  /** First docstring line of the module as plain text; empty when undocumented. */
  description: string;
}

/** Every page the plugin generates, in sidebar order, for every package. */
export async function listPydocsPages(context: PydocsContext): Promise<PydocsPageInfo[]> {
  const pages: PydocsPageInfo[] = [];
  for (const pkg of context.packages) {
    const model = await getModel(context, pkg.base);
    for (const page of model.pages) {
      pages.push({
        base: pkg.base,
        slug: page.slug,
        title: page.title,
        description: page.object.summary,
      });
    }
  }
  return pages;
}
