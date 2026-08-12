// Ambient types for the virtual modules registered by libs/vite.ts.

declare module 'virtual:starlight-pydocs/context' {
  const context: import('./lib/context.ts').PydocsContext;
  export default context;
}
