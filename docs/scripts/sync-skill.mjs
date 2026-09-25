// Generates `src/content/docs/guides/agent-skill.md` from the agent skill the
// npm package ships, so the page always shows the real skill rather than a
// copy that can drift. A generated Markdown page, not an MDX import, so the
// `.md` route and llms.txt carry the skill text too. Runs before dev / build /
// typecheck (see package.json); the generated file is gitignored.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('../../packages/starlight-pydocs/skills/starlight-pydocs/SKILL.md', import.meta.url);
const target = new URL('../src/content/docs/guides/agent-skill.md', import.meta.url);

const raw = await readFile(source, 'utf8');
// Drop the skill's own frontmatter and H1, and nest its sections under this
// page's "What the skill says" heading.
const body = raw
  .replace(/^---\n[\s\S]*?\n---\n+/, '')
  .replace(/^#\s[^\n]*\n+/, '')
  .replace(/^(#{2,5}) /gm, '#$1 ');

const page = `---
title: Agent skill
description: A setup checklist for starlight-pydocs, shipped as an agent skill for Claude Code, Codex and other coding agents.
editUrl: https://github.com/ewels/starlight-pydocs/edit/main/packages/starlight-pydocs/skills/starlight-pydocs/SKILL.md
---

<!-- Generated from packages/starlight-pydocs/skills/starlight-pydocs/SKILL.md by docs/scripts/sync-skill.mjs. Do not edit by hand. -->

starlight-pydocs ships an [agent skill](https://agentskills.io/): a short setup checklist that
coding agents such as Claude Code and Codex load when you ask them to add or configure the plugin.
It links to these guides rather than repeating them, so it stays correct as the plugin changes.
The skill is in the npm package at \`skills/starlight-pydocs/SKILL.md\`, and is reproduced in full
[below](#what-the-skill-says).

## Install the skill

### With the skills CLI

The [\`skills\` CLI](https://github.com/vercel-labs/skills) installs the skill from GitHub for any
agent it detects on your machine. Run it in your docs project:

\`\`\`sh
npx skills add ewels/starlight-pydocs
\`\`\`

To choose the agents yourself, pass \`-a\` once for each one (\`claude-code\`, \`codex\`, \`cursor\`,
\`opencode\`, and others). Add \`-g\` to install it for all your projects rather than only this one:

\`\`\`sh
npx skills add ewels/starlight-pydocs -a claude-code -a codex
\`\`\`

This installs the skill from the \`main\` branch. To use the copy that matches the version of
starlight-pydocs you have installed, point the CLI at the package instead:

\`\`\`sh
npx skills add ./node_modules/starlight-pydocs -a claude-code -a codex
\`\`\`

### By hand

A skill is a folder with a \`SKILL.md\` in it, so you can also link the folder from
\`node_modules\` into the directory your agent reads skills from. A symlink stays in step when you
upgrade the package.

**Claude Code** reads project skills from \`.claude/skills/\`, and personal skills from
\`~/.claude/skills/\` ([docs](https://code.claude.com/docs/en/skills)):

\`\`\`sh
mkdir -p .claude/skills
ln -s ../../node_modules/starlight-pydocs/skills/starlight-pydocs .claude/skills/starlight-pydocs
\`\`\`

**Codex** reads project skills from \`.agents/skills/\`, and personal skills from
\`~/.agents/skills/\` ([docs](https://learn.chatgpt.com/docs/build-skills)). Several other agents,
Cursor and OpenCode among them, read the same directory:

\`\`\`sh
mkdir -p .agents/skills
ln -s ../../node_modules/starlight-pydocs/skills/starlight-pydocs .agents/skills/starlight-pydocs
\`\`\`

These commands assume \`.claude/\` or \`.agents/\` sits next to \`node_modules/\`. The link is dangling
until the dependencies are installed, for example in a fresh clone.

### Using it

The agent loads the skill on its own when a task matches its description, such as adding
starlight-pydocs to a site. You can also call it by name: \`/starlight-pydocs\` in Claude Code, or
\`$starlight-pydocs\` in Codex.

## What the skill says

`;

await writeFile(fileURLToPath(target), page + body);
console.log('Synced Agent skill page from SKILL.md');
