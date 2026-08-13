# HANDOFF

What remains for a human before and around the first release. Everything else that
used to live here has a permanent home: architecture decisions, the griffe behaviour
notes and the build-time workarounds are in `ARCHITECTURE.md`, day-to-day conventions
are in `CLAUDE.md`, and the build history is in the git log. Delete this file once
the list below is done.

## Before the first release

- The first npm publish must be manual (`pnpm release` from the repository root; its
  `prepack` copies README, CHANGELOG and LICENCE into the package). Move the
  changelog's **Unreleased** section into a dated `## **Version 1.0.0**` first.
- Configure the npm trusted publisher (OIDC) on npmjs.com after that first publish;
  `.github/workflows/release.yml` assumes it exists. From then on, publishing a
  GitHub release tagged `vX.Y.Z` publishes to npm automatically, and the workflow
  refuses a tag that disagrees with the package version.
- Enable GitHub Pages (Settings, Pages, Source: GitHub Actions). The deploy workflow
  already runs on every push to `main`. Pages on a private repository needs a paid
  plan, so making the repository public is likely part of this step.

## Worth checking once real users appear

- Peer range: `astro >=7.0.0` is honoured through the markdown-remark fallback for
  7.0.x (unit-tested; the two fixture sites run Sätteri and `unified()` on current
  Astro). Raising the floor to `^7.1` would delete the fallback branch.
- griffe drift: the checked-in dumps came from griffe 2.1.0; `pnpm gen:dumps`
  regenerates them and the uv-guarded live tests catch surface drift in CI. griffe
  2.1.0 does not serialise `@typing.overload` variants; the renderer and a synthetic
  fixture are ready for the release that does.
- A site enabling `versions: { refs }` needs full git history in CI
  (`fetch-depth: 0`); the version-annotations guide says so.
- The twelve non-English locales were machine-authored; a native-speaker pass would
  be prudent before advertising them.
