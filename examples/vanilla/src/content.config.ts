import { defineCollection } from 'astro:content';
import { pydocsLoader } from 'starlight-pydocs/loader';

/**
 * The same model as data, through the Content Layer loader.
 *
 * `numpkg` is loaded from the checked-in dump rather than extracted, so this
 * collection needs no Python even when the integration above runs griffe.
 */
export const collections = {
  api: defineCollection({
    loader: pydocsLoader({ name: 'numpkg', source: { file: '../../fixtures/numpkg/dump.json' } }),
  }),
};
