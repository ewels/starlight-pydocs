/**
 * The public component surface, for hand-written pages and custom layouts.
 *
 * `<Autodoc>` is the one most pages need. The rest are exported so a site can
 * assemble its own page from the same pieces the generated routes use; they all
 * take a `RenderScope` built with `createRenderScope` from
 * `starlight-pydocs/render`.
 *
 * None of these import `@astrojs/starlight`, so they work in plain Astro too.
 * Every label can be overridden with the `labels` prop.
 */

export { default as Autodoc } from './Autodoc.astro';
export { default as SymbolSearch } from './SymbolSearch.astro';
export { default as ObjectDoc } from './ObjectDoc.astro';
export { default as ModuleDoc } from './ModuleDoc.astro';
export { default as ClassDoc } from './ClassDoc.astro';
export { default as FunctionDoc } from './FunctionDoc.astro';
export { default as AttributeDoc } from './AttributeDoc.astro';
export { default as Signature } from './Signature.astro';
export { default as AnnotationTokens } from './AnnotationTokens.astro';
export { default as DocstringSections } from './DocstringSections.astro';
export { default as MemberSummary } from './MemberSummary.astro';
export { default as SourceLink } from './SourceLink.astro';
export { default as Heading } from './Heading.astro';
