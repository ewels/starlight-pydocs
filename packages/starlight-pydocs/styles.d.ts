/**
 * Types for `starlight-pydocs/styles`.
 *
 * The export is a stylesheet, and `astro/tsconfigs/strictest` enables
 * `noUncheckedSideEffectImports`, so `import 'starlight-pydocs/styles'` is an
 * error in a consumer project unless the subpath resolves to a declaration. An
 * empty module is exactly right: importing the stylesheet has no bindings, only
 * an effect.
 */
export {};
