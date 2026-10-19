/**
 * Writes `describe.json`, the package's self-description for the extension market.
 *
 * The market reads this file instead of executing the package. It must match what the World
 * declares at runtime, so both sides are generated from `src/tools.js` and `ENV_PROMPT.md`:
 * re-run this after touching either.
 *
 *   node scripts/make-describe.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PERCH_TOOLS } from '../src/tools.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const prompt = readFileSync(new URL('../ENV_PROMPT.md', import.meta.url), 'utf8').trim();

const describe = {
  tools: PERCH_TOOLS,
  events: [],
  prompts: [{
    key: 'worlds.perch.envPrompt',
    title: '雷霆大跳系统提示词',
    role: 'envPrompt',
    content: prompt,
  }],
};

const out = `${root}/describe.json`;
writeFileSync(out, `${JSON.stringify(describe, null, 2)}\n`, 'utf8');
console.log(`wrote ${out} (${describe.tools.length} tools, ${describe.prompts.length} prompt)`);
