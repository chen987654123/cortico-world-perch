/**
 * Proves the patch works on a clean copy before it ever touches a real install.
 *
 *   1. copy the seven target files to a scratch directory;
 *   2. turn that copy back into the shipped version (the `.bak` files, and the inserted blocks removed);
 *   3. apply the patch; every file must come out byte-identical to the working install;
 *   4. restore; every file must come back to the shipped version.
 *
 *   node scripts/test-patch.mjs
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatch, findTarget, patchStatus, revertPatch } from '../src/patcher.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = join(root, '.patch-test');
// Under `node` the exec path is node.exe, so the app directory must be named explicitly.
const guess = process.env.PERCH_TARGET
  || 'D:/Program Files/coopanion/resources/app/node_modules/cortico-world-desktop-pet';
const real = findTarget({ targetDir: guess });
if (!real) {
  console.log('内置桌宠不在本机，跳过（发布包里不影响）');
  process.exit(0);
}

const index = JSON.parse(await readFile(join(root, 'patch/index.json'), 'utf8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1; };

await rm(scratch, { recursive: true, force: true });
await mkdir(scratch, { recursive: true });
await copyFile(join(real.dir, 'package.json'), join(scratch, 'package.json'));

// The shipped version of each file: the .bak where we have one, otherwise the inserted blocks removed.
const shipped = new Map();
for (const entry of index.files) {
  const live = join(real.dir, entry.path);
  const target = join(scratch, entry.path);
  await mkdir(dirname(target), { recursive: true });
  const bak = `${live}.bak`;
  if (existsSync(bak)) {
    await copyFile(bak, target);
    shipped.set(entry.path, sha(await readFile(target)));
    continue;
  }
  let lines = (await readFile(live, 'utf8')).split(/\r?\n/);
  for (const op of entry.ops ?? []) {
    const body = (await readFile(join(root, 'patch', op.insertFile), 'utf8')).replace(/\s+$/, '').split(/\r?\n/);
    const first = body[0], at = lines.indexOf(first);
    if (at < 0) { fail(`${entry.path}: 找不到插入块 ${op.insertFile}`); continue; }
    if (op.position === 'replace') lines.splice(at, body.length, ...op.anchor.split('\n'));
    else lines.splice(at, body.length);
  }
  await writeFile(target, lines.join('\n'), 'utf8');
  shipped.set(entry.path, sha(await readFile(target)));
}

const clean = await patchStatus({ targetDir: scratch });
if (!clean.found || clean.patched !== 0) fail(`干净副本应当 0 个已打补丁，实际 ${clean.patched}`);

const applied = await applyPatch({ targetDir: scratch });
if (!applied.ok) fail(`应用失败：${JSON.stringify(applied.results)}`);
for (const entry of index.files) {
  const got = sha(await readFile(join(scratch, entry.path)));
  const want = sha(await readFile(join(real.dir, entry.path)));
  if (got !== want) fail(`${entry.path} 应用后与工作版本不一致`);
}

const second = await applyPatch({ targetDir: scratch });
if (!second.results.every((r) => r.state === 'already')) fail(`重复应用不幂等：${JSON.stringify(second.results)}`);

const undone = await revertPatch({ targetDir: scratch });
if (!undone.ok) fail(`还原失败：${JSON.stringify(undone.results)}`);
for (const entry of index.files) {
  const got = sha(await readFile(join(scratch, entry.path)));
  if (got !== shipped.get(entry.path)) fail(`${entry.path} 还原后与原始版本不一致`);
}

if (!process.exitCode) console.log(`✓ ${index.files.length} 个文件：应用后一致、重复应用幂等、还原后一致`);
await rm(scratch, { recursive: true, force: true });
