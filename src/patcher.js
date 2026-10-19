/**
 * Applies the small, reviewed changes that let Coopanion's built-in desktop pet take its terrain
 * from this World. They are NOT applied on install: the console's panel shows the state and the
 * person clicks once, after which Coopanion needs a restart.
 *
 * Everything is reversible: each file is copied to `<name>.perch-orig` before the first change,
 * and "restore" puts those copies back. A file whose patch does not match is left untouched and
 * reported, so a different Coopanion version cannot end up half-patched.
 */
import { copyFile, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The package the patch targets, inside Coopanion's app directory. */
const TARGET = 'cortico-world-desktop-pet';
const PATCH_DIR = fileURLToPath(new URL('../patch/', import.meta.url));

/** Candidate app directories, most specific first. */
function candidates(ctx) {
  const out = [];
  if (process.execPath) out.push(join(dirname(process.execPath), 'resources', 'app'));
  if (process.resourcesPath) out.push(join(process.resourcesPath, 'app'));
  if (ctx?.repoRoot) out.push(resolve(ctx.repoRoot, 'resources', 'app'));
  if (ctx?.packageDir) out.push(resolve(ctx.packageDir, '..', '..'));
  return out;
}

/** Where the built-in desktop pet lives, or null when this Coopanion does not have it. */
export function findTarget(ctx) {
  // An explicit directory is for tests and for a portable Coopanion layout.
  const explicit = ctx?.targetDir ? join(ctx.targetDir) : '';
  if (explicit && existsSync(join(explicit, 'package.json'))) return { dir: explicit, app: dirname(explicit) };
  for (const app of candidates(ctx)) {
    const dir = join(app, 'node_modules', TARGET);
    if (existsSync(join(dir, 'package.json'))) return { dir, app };
  }
  return null;
}

const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const linesOf = (text) => text.split(/\r?\n/);

/** `@@ -a,b +c,d @@` hunks as { old: string[], new: string[] }. */
export function parseDiff(text) {
  const hunks = [];
  let current = null;
  for (const line of linesOf(text)) {
    if (line.startsWith('@@')) { current = { old: [], new: [] }; hunks.push(current); continue; }
    if (!current) continue;
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    // A context line is " " (one space) even when empty; a bare "" is just the file's last newline.
    if (line === '') continue;
    const tag = line[0], body = line.slice(1);
    if (tag === ' ') { current.old.push(body); current.new.push(body); }
    else if (tag === '-') current.old.push(body);
    else if (tag === '+') current.new.push(body);
  }
  return hunks.filter((h) => h.old.length || h.new.length);
}

/** Index of `block` in `lines` at or after `min`, or -1. */
function findBlock(lines, block, min = 0) {
  for (let i = Math.max(0, min); i <= lines.length - block.length; i += 1) {
    if (lines[i] !== block[0]) continue;
    let ok = true;
    for (let j = 1; j < block.length; j += 1) {
      if (lines[i + j] !== block[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

/** Apply every hunk, back to front; null when one does not match exactly. */
export function applyHunks(text, hunks) {
  const eol = eolOf(text);
  const lines = linesOf(text);
  const located = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const at = findBlock(lines, hunk.old, cursor);
    if (at < 0) return null;
    located.push({ at, hunk });
    cursor = at + hunk.old.length;
  }
  for (let i = located.length - 1; i >= 0; i -= 1) {
    const { at, hunk } = located[i];
    lines.splice(at, hunk.old.length, ...hunk.new);
  }
  return lines.join(eol);
}

/** Insert/replace ops: anchored on one exact line of the shipped file. */
export function applyOps(text, ops) {
  const eol = eolOf(text);
  let lines = linesOf(text);
  for (const op of ops) {
    const at = lines.findIndex((line) => line.trimEnd() === op.anchor.trimEnd());
    if (at < 0) return null;
    const first = op.text[0] ?? '';
    const last = op.text[op.text.length - 1] ?? '';
    // Already there? Judge by the line the insert would sit next to, so pressing twice is a no-op
    // even when the same text also appears elsewhere in the file.
    const present = op.position === 'replace'
      ? lines[at] === first
      : op.position === 'before'
        ? lines[at - 1] === last
        : lines[at + 1] === first;
    if (present) continue;
    if (op.position === 'replace') lines.splice(at, 1, ...op.text);
    else if (op.position === 'before') lines.splice(at, 0, ...op.text);
    else lines.splice(at + 1, 0, ...op.text);
  }
  return lines.join(eol);
}

const readPatchIndex = async () => JSON.parse(await readFile(join(PATCH_DIR, 'index.json'), 'utf8'));

export async function fileState(dir, entry) {
  const file = join(dir, entry.path);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return { rel: entry.path, state: 'missing', file };
  }
  // For anchored inserts, "patched" means every block is already there; a file from an older
  // release has some of them and still needs the rest, so this is checked per block.
  if (entry.ops) {
    let all = true;
    for (const op of entry.ops) {
      const first = (await readFile(join(PATCH_DIR, op.insertFile), 'utf8')).replace(/\s+$/, '').split(/\r?\n/)[0];
      if (!text.includes(first)) { all = false; break; }
    }
    return { rel: entry.path, state: all ? 'patched' : 'clean', file, text };
  }
  const patched = !!entry.marker && text.includes(entry.marker);
  return { rel: entry.path, state: patched ? 'patched' : 'clean', file, text };
}

export async function patchStatus(ctx) {
  const target = findTarget(ctx);
  if (!target) return { found: false, reason: '找不到 Coopanion 内置桌宠（只支持桌面版 Coopanion）', files: [] };
  const index = await readPatchIndex();
  const files = [];
  for (const entry of index.files) {
    const st = await fileState(target.dir, entry);
    files.push({
      rel: entry.path,
      state: st.state,
      backedUp: existsSync(`${join(target.dir, entry.path)}.perch-orig`),
    });
  }
  return {
    found: true,
    dir: target.dir,
    verified: index.verified,
    patched: files.filter((f) => f.state === 'patched').length,
    total: files.length,
    files,
  };
}

/** Apply the patch; a file that does not match stays as it was. Safe to press twice. */
export async function applyPatch(ctx) {
  const target = findTarget(ctx);
  if (!target) return { ok: false, reason: '找不到 Coopanion 内置桌宠', results: [] };
  const index = await readPatchIndex();
  const results = [];
  for (const entry of index.files) {
    const st = await fileState(target.dir, entry);
    if (st.state === 'missing') { results.push({ rel: entry.path, state: 'missing' }); continue; }
    if (st.state === 'patched') { results.push({ rel: entry.path, state: 'already' }); continue; }
    let next = null;
    try {
      if (entry.diff) next = applyHunks(st.text, parseDiff(await readFile(join(PATCH_DIR, entry.diff), 'utf8')));
      else if (entry.ops) {
        const ops = [];
        for (const op of entry.ops) {
          const body = op.insertFile ? await readFile(join(PATCH_DIR, op.insertFile), 'utf8') : (op.insert ?? '');
          ops.push({ ...op, text: linesOf(body.replace(/\s+$/, '')) });
        }
        next = applyOps(st.text, ops);
      }
    } catch {
      next = null;
    }
    if (next === null || (entry.marker && !next.includes(entry.marker))) {
      results.push({ rel: entry.path, state: 'mismatch' });
      continue;
    }
    const backup = `${st.file}.perch-orig`;
    try {
      if (!existsSync(backup)) await copyFile(st.file, backup);
      await writeFile(st.file, next, 'utf8');
      results.push({ rel: entry.path, state: 'applied' });
    } catch (error) {
      results.push({ rel: entry.path, state: 'failed', reason: error?.message ?? String(error) });
    }
  }
  const ok = results.every((r) => r.state !== 'mismatch' && r.state !== 'failed');
  return { ok, results, restartRequired: results.some((r) => r.state === 'applied') };
}

/** Put the `.perch-orig` copies back and drop them. */
export async function revertPatch(ctx) {
  const target = findTarget(ctx);
  if (!target) return { ok: false, reason: '找不到 Coopanion 内置桌宠', results: [] };
  const index = await readPatchIndex();
  const results = [];
  for (const entry of index.files) {
    const file = join(target.dir, entry.path);
    const backup = `${file}.perch-orig`;
    if (!existsSync(backup)) { results.push({ rel: entry.path, state: 'no-backup' }); continue; }
    try {
      await copyFile(backup, file);
      await unlink(backup);
      results.push({ rel: entry.path, state: 'restored' });
    } catch (error) {
      results.push({ rel: entry.path, state: 'failed', reason: error?.message ?? String(error) });
    }
  }
  return { ok: results.every((r) => r.state !== 'failed'), results };
}

/** Bytes held by the backups, for the panel's note. */
export async function backupInfo(ctx) {
  const target = findTarget(ctx);
  if (!target) return null;
  const index = await readPatchIndex();
  let bytes = 0;
  for (const entry of index.files) {
    try { bytes += (await stat(join(target.dir, `${entry.path}.perch-orig`))).size; } catch { /* none */ }
  }
  return { dir: target.dir, bytes };
}
