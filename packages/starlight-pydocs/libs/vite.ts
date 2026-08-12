import type { ViteUserConfig } from 'astro';

import type { PydocsContext } from '../lib/context.ts';

type VitePlugin = NonNullable<ViteUserConfig['plugins']>[number];

/**
 * Registers `virtual:starlight-pydocs/context`. The context is small by design
 * (config + dump paths); see lib/context.ts.
 */
export function vitePluginStarlightPydocs(context: PydocsContext): VitePlugin {
  const modules: Record<string, string> = {
    'virtual:starlight-pydocs/context': `export default ${JSON.stringify(context)}`,
  };

  const moduleResolutionMap = Object.fromEntries(Object.keys(modules).map((key) => [resolveVirtualModuleId(key), key]));

  return {
    name: 'vite-plugin-starlight-pydocs',
    load(id) {
      const moduleId = moduleResolutionMap[id];
      return moduleId ? modules[moduleId] : undefined;
    },
    resolveId(id) {
      return id in modules ? resolveVirtualModuleId(id) : undefined;
    },
  };
}

function resolveVirtualModuleId<TModuleId extends string>(id: TModuleId): `\0${TModuleId}` {
  return `\0${id}`;
}
