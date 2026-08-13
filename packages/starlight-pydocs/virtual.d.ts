// Ambient types for the virtual modules registered by libs/vite.ts.

declare module 'virtual:starlight-pydocs/context' {
  const context: import('./lib/context.ts').PydocsContext;
  export default context;
}

declare module 'virtual:starlight-pydocs/components' {
  export const ModuleDoc: typeof import('./components/ModuleDoc.astro').default;
  export const ClassDoc: typeof import('./components/ClassDoc.astro').default;
  export const FunctionDoc: typeof import('./components/FunctionDoc.astro').default;
  export const AttributeDoc: typeof import('./components/AttributeDoc.astro').default;
  export const Signature: typeof import('./components/Signature.astro').default;
  export const DocstringSections: typeof import('./components/DocstringSections.astro').default;
  export const MemberSummary: typeof import('./components/MemberSummary.astro').default;
  export const SourceLink: typeof import('./components/SourceLink.astro').default;
  export const Heading: typeof import('./components/Heading.astro').default;
}

declare module 'virtual:starlight-pydocs/vanilla-layout' {
  const Layout: typeof import('./layouts/VanillaLayout.astro').default;
  export default Layout;
}
