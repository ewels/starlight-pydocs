/**
 * The virtual modules the routes, components and middleware import.
 *
 * Three of them:
 *
 * - `virtual:starlight-pydocs/context`: the validated configuration plus the
 *   path of each dump. Deliberately small: dumps are megabytes and stay on
 *   disk (PLAN.md decision 4). It is generated on every `load`, so the dev
 *   watcher can invalidate it after a re-extraction and get fresh paths.
 * - `virtual:starlight-pydocs/components`: the overridable components,
 *   re-exported from either the user's entrypoint or ours.
 * - `virtual:starlight-pydocs/vanilla-layout`: the layout the vanilla routes
 *   render, either the built-in one or the user's.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ViteUserConfig } from 'astro';

import type { OverridableComponentName } from '../lib/config.ts';
import { OVERRIDABLE_COMPONENTS } from '../lib/config.ts';
import type { PydocsContext } from '../lib/context.ts';

type VitePlugin = NonNullable<ViteUserConfig['plugins']>[number];

export const PYDOCS_CONTEXT_MODULE = 'virtual:starlight-pydocs/context';
export const PYDOCS_COMPONENTS_MODULE = 'virtual:starlight-pydocs/components';
export const PYDOCS_VANILLA_LAYOUT_MODULE = 'virtual:starlight-pydocs/vanilla-layout';

/** Vite's id for a resolved virtual module. */
export function resolveVirtualModuleId<TModuleId extends string>(id: TModuleId): `\0${TModuleId}` {
  return `\0${id}`;
}

export interface VitePluginOptions {
  /**
   * Reads the current context. A getter rather than a value so a dev-server
   * re-extraction can publish new dump paths without rebuilding the plugin.
   */
  getContext: () => PydocsContext;
  /** Component overrides, keyed by overridable name. */
  components: Partial<Record<OverridableComponentName, string>>;
  /** Absolute project root, used to resolve relative override paths. */
  projectRoot: string;
  /** The vanilla layout's specifier, or undefined for the built-in layout. */
  vanillaLayout?: string | undefined;
}

/** Resolve a user-supplied specifier: relative paths against the project root. */
function resolveUserSpecifier(specifier: string, projectRoot: string): string {
  return specifier.startsWith('.') || path.isAbsolute(specifier) ? path.resolve(projectRoot, specifier) : specifier;
}

/** Absolute path of a file shipped by this package. */
function packageFile(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

export function vitePluginStarlightPydocs(options: VitePluginOptions): VitePlugin {
  const componentExports = OVERRIDABLE_COMPONENTS.map((name) => {
    const override = options.components[name];
    const from =
      override === undefined
        ? packageFile(`../components/${name}.astro`)
        : resolveUserSpecifier(override, options.projectRoot);
    return `export { default as ${name} } from ${JSON.stringify(from)};`;
  }).join('\n');

  const layout =
    options.vanillaLayout === undefined
      ? packageFile('../layouts/VanillaLayout.astro')
      : resolveUserSpecifier(options.vanillaLayout, options.projectRoot);

  const staticModules: Record<string, string> = {
    [PYDOCS_COMPONENTS_MODULE]: componentExports,
    [PYDOCS_VANILLA_LAYOUT_MODULE]: `export { default } from ${JSON.stringify(layout)};`,
  };

  const ids = [PYDOCS_CONTEXT_MODULE, ...Object.keys(staticModules)];
  const moduleResolutionMap = Object.fromEntries(ids.map((id) => [resolveVirtualModuleId(id), id]));

  return {
    name: 'vite-plugin-starlight-pydocs',
    load(id) {
      const moduleId = moduleResolutionMap[id];
      if (moduleId === undefined) return undefined;
      if (moduleId === PYDOCS_CONTEXT_MODULE) {
        return `export default ${JSON.stringify(options.getContext())}`;
      }
      return staticModules[moduleId];
    },
    resolveId(id) {
      return ids.includes(id) ? resolveVirtualModuleId(id) : undefined;
    },
  };
}
