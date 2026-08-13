/** @type {import('prettier').Config} */
export default {
  printWidth: 120,
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  plugins: ['prettier-plugin-astro'],
  overrides: [
    { files: '*.astro', options: { parser: 'astro' } },
    // Leave code inside markdown fences untouched: reflowing the Python and
    // directive examples misrepresents the syntax being documented.
    { files: '*.md', options: { embeddedLanguageFormatting: 'off' } },
  ],
};
