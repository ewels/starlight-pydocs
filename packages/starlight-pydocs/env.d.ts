/// <reference types="astro/client" />

// Teach Starlight about the translation keys this plugin injects, so that
// `Astro.locals.t('starlightPydocs.…')` is type-checked end to end. This only
// applies when the consumer uses Starlight; it has no effect in vanilla Astro.
declare namespace StarlightApp {
  type PydocsStrings = typeof import('./lib/strings.ts').STRINGS;
  type PydocsTranslations = {
    [Key in keyof PydocsStrings as `starlightPydocs.${Key & string}`]: string;
  };
  interface I18n extends PydocsTranslations {}
}
