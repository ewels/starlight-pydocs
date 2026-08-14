# Contributing

Contributions are welcome. This page is the quick start; the
[Contributing guide](https://ewels.github.io/starlight-pydocs/guides/contributing/) on the
documentation site covers fixtures, architecture rules and releases in full.

## Get it running

A pnpm workspace, Node ≥ 22.12. Python is not needed to develop: the Griffe dumps under
`fixtures/` are checked in, so the unit tests never shell out.

pnpm comes from npm — `npm install -g pnpm`. Corepack was removed from Node in v25, so
`corepack enable` is not an option on a current Node.

```sh
git clone https://github.com/ewels/starlight-pydocs
cd starlight-pydocs
pnpm install
prek install    # git pre-commit hook: prettier → eslint → typecheck
pnpm dev
```

The docs site is served under its base path: open
**<http://localhost:4321/starlight-pydocs>**, not bare `localhost:4321`.

First run extracts the fixture packages with `uvx --from griffe`, so it wants
[`uv`](https://docs.astral.sh/uv/) on `PATH`. Without it you still get `sphpkg`, which reads a
pre-generated dump. Results cache into `node_modules/.astro`, so later starts are quick.

The package ships its `.ts` and `.astro` source with no build step. Edits inside
`packages/starlight-pydocs` are picked up by the dev server directly.

## Checks

| Task                          | Command                     |
| ----------------------------- | --------------------------- |
| Unit tests (Vitest)           | `pnpm test`                 |
| End-to-end tests (Playwright) | `pnpm test:e2e`             |
| Type-check                    | `pnpm typecheck`            |
| Lint · format                 | `pnpm lint` · `pnpm format` |
| Everything, as CI runs it     | `prek run --all-files`      |

## Before you open a pull request

- Add a line under **Unreleased** in `CHANGELOG.md`, in the same pull request as the change. The
  changelog page on the site is generated from it.
- Changed a fixture package? Run `pnpm gen:dumps` (needs `uv`) and commit the JSON with it.
- `.mdx` is formatted by hand. Prettier reflows the Python signatures and directive examples in
  the guides, so it is set to skip those files.

`ARCHITECTURE.md` records the design decisions and why the rejected alternatives were rejected.
Two rules to know before changing the package: `lib/` never imports `astro` or
`@astrojs/starlight`, and the package registers no remark or rehype plugin.
