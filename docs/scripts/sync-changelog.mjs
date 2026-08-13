// Generates `src/content/docs/changelog.md` from the repository-root
// CHANGELOG.md, so the Changelog page always shows the real changelog rather
// than a copy that can drift. Runs automatically before dev / build / typecheck
// (see package.json); the generated file is gitignored.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('../../CHANGELOG.md', import.meta.url);
const target = new URL('../src/content/docs/changelog.md', import.meta.url);

const raw = await readFile(source, 'utf8');
// Drop the leading "# Changelog" H1: Starlight renders the page title from frontmatter.
const body = raw.replace(/^#\s+Changelog[^\n]*\n+/, '');

const frontmatter = `---
title: Changelog
description: Release notes for every published version of starlight-pydocs.
editUrl: false
---

<!-- Generated from the repository-root CHANGELOG.md by docs/scripts/sync-changelog.mjs. Do not edit by hand. -->

`;

await writeFile(fileURLToPath(target), frontmatter + body);
console.log('Synced Changelog page from CHANGELOG.md');
