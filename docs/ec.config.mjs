import { pluginCollapsibleSections } from '@expressive-code/plugin-collapsible-sections';

// Expressive Code config lives here rather than in `astro.config.ts` because a
// plugin instance is not JSON-serialisable, and Starlight's `<Code>` component
// needs a serialisable config. Keeping it in this file from the start avoids the
// error that swap would otherwise cause later.
/** @type {import('@astrojs/starlight/expressive-code').StarlightExpressiveCodeOptions} */
export default {
  plugins: [pluginCollapsibleSections()],
  defaultProps: {
    // Reference docs get re-read, so a reader who expanded the boilerplate in a
    // config example wants to be able to hide it again. The `github` default
    // cannot re-collapse.
    collapseStyle: 'collapsible-auto',
  },
};
