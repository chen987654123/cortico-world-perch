/**
 * Release checklist for the extension market, mirroring `pnpm check:extension` where it matters.
 *
 *   node scripts/check-package.mjs
 *
 * Reads the tag vocabulary from `.market/index.json` when present (fetch it from
 * Pal-AI-Lab/cortico-extensions), otherwise skips the tag check.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PERCH_TOOLS } from '../src/tools.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
const problems = [];
const warnings = [];
const ok = [];
const fail = (m) => problems.push(m);
const warn = (m) => warnings.push(m);

/* ---------- package.json ---------- */
if (pkg.private) fail('package.json 仍然是 "private": true，npm 会拒绝发布');
if (pkg.type !== 'module') fail('type 必须是 "module"');
if (!/^\d+\.\d+\.\d+/.test(pkg.version ?? '')) fail('version 必须是语义化版本');
if (!pkg.description) warn('缺少 description，市场卡片没有简介');
if (!pkg.license) warn('缺少 license');

const c = pkg.cortico ?? {};
if (c.kind !== 'world') fail('cortico.kind 必须是 "world"');
if (c.api !== 6) fail(`cortico.api 应为 6，当前 ${c.api}`);
if (!c.displayName) fail('缺少 cortico.displayName');
for (const key of ['webUiClient', 'webUiStyle', 'describe', 'icon']) {
  const rel = c[key];
  if (!rel) { warn(`缺少 cortico.${key}`); continue; }
  if (!existsSync(`${root}/${rel}`)) fail(`cortico.${key} 指向不存在的文件 ${rel}`);
}

/* ---------- tags ---------- */
const tags = Array.isArray(c.tags) ? c.tags : [];
const indexFile = `${root}/.market/index.json`;
if (existsSync(indexFile)) {
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  for (const t of tags) {
    const entry = index.tags?.[t];
    if (!entry) fail(`标签 "${t}" 不在词表里`);
    else if (entry.style === 'official') fail(`"${t}" 是官方标注，作者声明无效`);
  }
  ok.push(`tags: ${tags.join(', ') || '(none)'}`);
} else {
  warn('没有 .market/index.json，跳过标签词表核对');
}

/* ---------- describe.json ---------- */
const describePath = `${root}/${c.describe ?? 'describe.json'}`;
if (existsSync(describePath)) {
  const describe = JSON.parse(readFileSync(describePath, 'utf8'));
  const strip = (t) => JSON.stringify({ name: t.name, description: t.description, tags: t.tags, parameters: t.parameters, summary: t.summary });
  const want = PERCH_TOOLS.map(strip).join('\n');
  const have = (describe.tools ?? []).map(strip).join('\n');
  if (want !== have) fail('describe.json 与 src/tools.js 不一致，运行 node scripts/make-describe.mjs');
  else ok.push(`describe.json: ${describe.tools.length} 个工具`);
  if (!describe.prompts?.length) warn('describe.json 没有 prompts（环境提示词模板）');
} else {
  fail('缺少 describe.json，运行 node scripts/make-describe.mjs');
}

/* ---------- changelog ---------- */
const changelog = `${root}/CHANGELOG.md`;
if (!existsSync(changelog)) fail('缺少 CHANGELOG.md');
else if (!new RegExp(`^##\\s+\\[?${pkg.version.replace(/\./g, '\\.')}`, 'm').test(readFileSync(changelog, 'utf8'))) {
  fail(`CHANGELOG.md 没有 "## ${pkg.version}" 段`);
} else ok.push(`CHANGELOG.md: 有 ${pkg.version} 段`);

/* ---------- icon ---------- */
if (c.icon && existsSync(`${root}/${c.icon}`)) {
  const size = statSync(`${root}/${c.icon}`).size;
  if (size > 512 * 1024) fail(`${c.icon} 超过 512KB（${size} 字节）`);
  else ok.push(`icon: ${c.icon} (${(size / 1024).toFixed(1)}KB)`);
}

/* ---------- compatibility patch ---------- */
const patchIndexFile = `${root}/patch/index.json`;
if (!existsSync(patchIndexFile)) fail('缺少 patch/index.json（一键兼容补丁）');
else {
  const index = JSON.parse(readFileSync(patchIndexFile, 'utf8'));
  let missing = 0;
  for (const entry of index.files ?? []) {
    if (entry.diff && !existsSync(`${root}/patch/${entry.diff}`)) { fail(`补丁缺少 ${entry.diff}`); missing += 1; }
    for (const op of entry.ops ?? []) {
      if (op.insertFile && !existsSync(`${root}/patch/${op.insertFile}`)) { fail(`补丁缺少 ${op.insertFile}`); missing += 1; }
    }
  }
  if (!missing) ok.push(`patch: ${index.files.length} 个文件`);
}
if (!pkg.files?.includes('patch')) fail('files 白名单里没有 patch');

/* ---------- files ---------- */
if (!Array.isArray(pkg.files) || !pkg.files.length) warn('没有 files 白名单，npm 会打包多余文件');
else if (!pkg.files.includes('describe.json')) fail('files 白名单里没有 describe.json');

/* ---------- report ---------- */
for (const line of ok) console.log(`  ✓ ${line}`);
for (const line of warnings) console.log(`  ⚠ ${line}`);
for (const line of problems) console.log(`  ✗ ${line}`);
console.log(problems.length ? `\n${problems.length} 个问题需要先修` : '\n可以发布:npm publish --access public');
process.exit(problems.length ? 1 : 0);
