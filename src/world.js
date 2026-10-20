/**
 * The perch World: a companion that stands on the top edge of any window and super-jumps
 * between windows and the bottom of the desktop.
 *
 * It serves its page on 127.0.0.1 and opens it in the app's own pet-host window
 * (`--pet-host`, transparent, always on top, mouse-through), the same window the desktop pet
 * uses. The page asks for window geometry, runs the motion, and reports where it is.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayAt, displayWorkAreas, windows } from './win32.js';
import { PERCH_TOOLS } from './tools.js';
import { applyPatch, patchStatus, revertPatch } from './patcher.js';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
// The Core prompt loader reads `promptDocs.path` directly. Use the package file's absolute path;
// a relative `ENV_PROMPT.md` is incorrectly resolved against resources/app and causes ENOENT.
const ENV_PROMPT = fileURLToPath(new URL('../ENV_PROMPT.md', import.meta.url));
const DEFAULT_PROMPT_TEMPLATE = readFileSync(ENV_PROMPT, 'utf8');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The console's on/off switches, in panel order. */
const FEATURE_KEYS = ['windowPerching', 'edgeLeaps', 'autoWindowHops', 'autoRoamingJumps', 'aiThunderJump'];

export class PerchWorld {
  id = 'perch';
  /** Fixed so the desktop pet's page can poll it without discovering a port. */
  static PORT = 47650;
  #cfg;
  #ctx = null;
  #server = null;
  #child = null;
  #port = 0;
  #state = null;
  #pending = null;
  #pendingAt = 0;
  #paused = false;
  #log = null;
  #settings = {
    maxJumpHeight: 900,
    jumpCooldown: 8,
    windowPerching: true,
    edgeLeaps: true,
    autoWindowHops: true,
    autoRoamingJumps: true,
    aiThunderJump: true,
  };
  #lastAskAt = 0;
  #lastPetPage = null;
  #lastPetWhy = null;
  #lastTakeLogAt = 0;
  #lastJumpCommandAt = 0;
  #screen = null;
  #promptOverridePath = '';
  #stopped = false;

  constructor(ctx) {
    this.#ctx = ctx ?? null;
    this.#cfg = {
      minWidth: 240,
      minHeight: 120,
      excludeTitles: [],
      ...(ctx?.cfg ?? {}),
    };
    this.#settings.maxJumpHeight = clampNumber(this.#cfg.maxJumpHeight, 900, 70, 2000);
    this.#settings.jumpCooldown = clampNumber(this.#cfg.jumpCooldown, 8, 0, 120);
    for (const key of FEATURE_KEYS) {
      this.#settings[key] = this.#cfg[key] !== false;
    }
    // Core writes World envPrompt edits to <deployment>/worlds/perch/ENV_PROMPT.md.
    // Keep the package template immutable and let Core's override resolver select this file.
    if (this.#ctx?.botDir) this.#promptOverridePath = join(this.#ctx.botDir, 'worlds', this.id, 'ENV_PROMPT.md');
  }

  async start(host) {
    this.#stopped = false;
    this.#log = host?.log ?? null;
    this.#server = createServer((req, res) => { void this.#handle(req, res); });
    this.#port = Number(this.#cfg.port ?? PerchWorld.PORT);
    await new Promise((done, fail) => {
      this.#server.once('error', fail);
      this.#server.listen(this.#port, '127.0.0.1', done);
    });
    this.#port = this.#server.address().port;
    host?.log?.info?.(`perch: terrain on http://127.0.0.1:${this.#port}/api/terrain`);
    if ((this.#cfg.mode ?? 'attach') === 'window') await this.#launch(host);
    else host?.log?.info?.('perch: attach mode — the desktop pet walks on the window tops, no window of its own');
  }

  async stop() {
    this.#stopped = true;
    this.#child?.kill();
    this.#child = null;
    if (this.#server) await new Promise((done) => this.#server.close(done));
    this.#server = null;
  }

  tools() {
    // The declarations live in tools.js so the package's describe.json is generated from the
    // same text the model receives; only the handlers are bound here.
    return PERCH_TOOLS.map((decl) => ({
      ...decl,
      ...(decl.name === 'perch_status'
        ? { handler: async () => JSON.stringify(this.#snapshot()) }
        : { handler: async (args = {}) => this.#hopTool(args) }),
    }));
  }

  async #hopTool(args) {
    if (!this.#settings.aiThunderJump) return JSON.stringify({ ok: false, disabled: 'aiThunderJump' });
    const height = Math.min(this.#settings.maxJumpHeight, clampNumber(args?.height, this.#settings.maxJumpHeight, 70, 2000));
    let target = null;
    try {
      target = this.#resolveTarget(args);
    } catch (error) {
      return JSON.stringify({ ok: false, error: error?.message ?? String(error), windows: this.#targetList() });
    }
    const accepted = await this.#command('hop', { target: target?.point ?? target?.mode ?? 'next', apex: height, label: target?.label ?? null });
    return JSON.stringify({
      ok: accepted,
      ...(accepted
        ? { target: target ?? { mode: 'auto' }, height, maxJumpHeight: this.#settings.maxJumpHeight }
        : { reason: 'cooldown', jumpCooldown: this.#settings.jumpCooldown }),
      ...(target ? {} : { windows: this.#targetList() }),
    });
  }

  /** The console's panel for this World: status, a "hop now" button and a pause switch. */
  webUi() {
    return {
      // Core's prompt editor uses this declaration too. Its deployment override is the same
      // file written by the custom panel below, so the editor and the actual prefix stay in sync.
      promptDocs: [{
        key: 'worlds.perch.envPrompt',
        title: '雷霆大跳系统提示词',
        description: '控制 Coo 站窗、跳跃和 perch_hop 工具行为的环境提示词模板。保存后下一轮系统提示词立即使用。',
        path: ENV_PROMPT,
        deploymentPath: this.#promptOverridePath || undefined,
        role: 'envPrompt',
        vars: [
          { name: 'maxJumpHeight', description: '当前允许的最大跳跃高度（像素）' },
          { name: 'jumpCooldown', description: 'AI 大跳冷却时间（秒）' },
        ],
      }],
      panels: [{ id: 'perch', title: '雷霆大跳' }],
      // `args` arrives as an array (the panel contract is `invoke(method, args?: unknown[])`).
      // Accept both shapes so a panel written either way cannot silently lose its value.
      invoke: async (panel, method, args = []) => {
        if (panel !== 'perch') throw new Error(`unknown panel ${panel}`);
        const arg = Array.isArray(args) ? args[0] : args;
        switch (method) {
          case 'state': return this.#panelState();
          case 'hop': {
            if (!this.#settings.aiThunderJump) return { ok: false, disabled: 'aiThunderJump' };
            // the panel can name a destination; without one the pet picks a spot away from itself
            let target = null;
            try {
              target = this.#resolveTarget(arg && typeof arg === 'object' ? arg : {});
            } catch (error) {
              return { ok: false, error: error?.message ?? String(error), windows: this.#targetList() };
            }
            const accepted2 = await this.#command('hop', {
              target: target?.point ?? target?.mode ?? 'next',
              apex: this.#settings.maxJumpHeight,
              label: target?.label ?? null,
              ignoreCooldown: true,
            });
            return accepted2 ? { ok: true, target } : { ok: false, reason: 'busy' };
          }
          case 'setMaxJumpHeight':
            this.#settings.maxJumpHeight = clampNumber(
              typeof arg === 'object' && arg !== null ? arg.value : arg,
              this.#settings.maxJumpHeight,
              70,
              2000,
            );
            this.#persistSetting({ maxJumpHeight: this.#settings.maxJumpHeight });
            return { ok: true, maxJumpHeight: this.#settings.maxJumpHeight };
          case 'setJumpCooldown':
            this.#settings.jumpCooldown = clampNumber(
              typeof arg === 'object' && arg !== null ? arg.value : arg,
              this.#settings.jumpCooldown,
              0,
              120,
            );
            this.#persistSetting({ jumpCooldown: this.#settings.jumpCooldown });
            return { ok: true, jumpCooldown: this.#settings.jumpCooldown };
          case 'setFeatures': {
            const patch = {};
            for (const key of FEATURE_KEYS) {
              if (typeof arg?.[key] === 'boolean') {
                this.#settings[key] = arg[key];
                patch[key] = arg[key];
              }
            }
            this.#persistSetting(patch);
            return { ok: true, features: { ...this.#settings } };
          }
          // one call for the whole form: switches, numbers and the title filter land together
          case 'applyAll': {
            const input = arg && typeof arg === 'object' ? arg : {};
            const patch = {};
            for (const key of FEATURE_KEYS) {
              if (typeof input[key] === 'boolean') { this.#settings[key] = input[key]; patch[key] = input[key]; }
            }
            if (input.maxJumpHeight != null) {
              this.#settings.maxJumpHeight = clampNumber(input.maxJumpHeight, this.#settings.maxJumpHeight, 70, 2000);
              patch.maxJumpHeight = this.#settings.maxJumpHeight;
            }
            if (input.jumpCooldown != null) {
              this.#settings.jumpCooldown = clampNumber(input.jumpCooldown, this.#settings.jumpCooldown, 0, 120);
              patch.jumpCooldown = this.#settings.jumpCooldown;
            }
            for (const [key, min, max] of [['minWidth', 80, 2000], ['minHeight', 60, 2000], ['headroom', 0, 500]]) {
              if (input[key] != null) {
                this.#cfg[key] = clampNumber(input[key], this.#cfg[key] ?? min, min, max);
                patch[key] = this.#cfg[key];
              }
            }
            if (Array.isArray(input.excludeTitles)) {
              this.#cfg.excludeTitles = input.excludeTitles.map((v) => String(v).trim()).filter(Boolean).slice(0, 50);
              patch.excludeTitles = this.#cfg.excludeTitles;
            }
            this.#persistSetting(patch);
            return { ok: true, settings: this.#publicSettings() };
          }
          case 'setGeometry': {
            const patch = {};
            for (const [key, min, max, fallback] of [
              ['minWidth', 80, 2000, 240],
              ['minHeight', 60, 2000, 120],
              ['headroom', 0, 500, 56],
            ]) {
              if (typeof arg?.[key] !== 'undefined') {
                this.#cfg[key] = clampNumber(arg[key], this.#cfg[key] ?? fallback, min, max);
                patch[key] = this.#cfg[key];
              }
            }
            this.#persistSetting(patch);
            return { ok: true, geometry: { minWidth: this.#cfg.minWidth, minHeight: this.#cfg.minHeight, headroom: this.#cfg.headroom } };
          }
          case 'setExcludeTitles': {
            const values = Array.isArray(arg) ? arg : arg?.values;
            this.#cfg.excludeTitles = Array.isArray(values) ? values.map((v) => String(v).trim()).filter(Boolean).slice(0, 50) : this.#cfg.excludeTitles;
            this.#persistSetting({ excludeTitles: this.#cfg.excludeTitles });
            return { ok: true, excludeTitles: [...this.#cfg.excludeTitles] };
          }
          case 'prompt': return this.#promptState();
          case 'setPrompt': {
            const content = typeof arg === 'string' ? arg : arg?.content;
            if (typeof content !== 'string') throw new Error('prompt template must be text');
            if (content.length > 64_000) throw new Error('prompt template is too large (64KB maximum)');
            await this.#writePrompt(content);
            return { ok: true, ...this.#promptState(), saved: true };
          }
          case 'resetPrompt': {
            if (this.#promptOverridePath && existsSync(this.#promptOverridePath)) await unlink(this.#promptOverridePath);
            return { ok: true, ...this.#promptState(), reset: true };
          }
          case 'defaults': {
            const defaults = { minWidth: 240, minHeight: 120, headroom: 56, maxJumpHeight: 900, jumpCooldown: 8, windowPerching: true, edgeLeaps: true, autoWindowHops: true, autoRoamingJumps: true, aiThunderJump: true, excludeTitles: [] };
            Object.assign(this.#cfg, defaults);
            Object.assign(this.#settings, { maxJumpHeight: 900, jumpCooldown: 8, windowPerching: true, edgeLeaps: true, autoWindowHops: true, autoRoamingJumps: true, aiThunderJump: true });
            this.#persistSetting(defaults);
            return { ok: true, settings: this.#publicSettings() };
          }
          // The one-click alternative to editing Coopanion by hand: apply the small terrain hook
          // to the built-in desktop pet. Nothing happens until the person presses it.
          case 'compat': return patchStatus(this.#ctx);
          case 'applyCompat': {
            const result = await applyPatch(this.#ctx);
            this.#log?.info?.(`perch: compatibility patch ${result.ok ? 'applied' : 'failed'} ${JSON.stringify(result.results)}`);
            return result;
          }
          case 'revertCompat': {
            const result = await revertPatch(this.#ctx);
            this.#log?.info?.(`perch: compatibility patch reverted ${JSON.stringify(result.results)}`);
            return result;
          }
          case 'pause': this.#paused = true; return { ok: true };
          case 'resume': this.#paused = false; return { ok: true };
          default: throw new Error(`unknown method ${method}`);
        }
      },
    };
  }

  envPromptVars() { return { maxJumpHeight: String(this.#settings.maxJumpHeight), jumpCooldown: String(this.#settings.jumpCooldown) }; }

  #promptState() {
    const override = this.#promptOverridePath && existsSync(this.#promptOverridePath);
    const path = override ? this.#promptOverridePath : ENV_PROMPT;
    return {
      content: readFileSync(path, 'utf8'),
      origin: override ? 'deployment' : 'module',
      hasOverride: !!override,
      defaultContent: DEFAULT_PROMPT_TEMPLATE,
    };
  }

  async #writePrompt(content) {
    if (!this.#promptOverridePath) throw new Error('deployment directory is unavailable');
    await mkdir(dirname(this.#promptOverridePath), { recursive: true });
    const tmp = `${this.#promptOverridePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(tmp, content, 'utf8');
      await rename(tmp, this.#promptOverridePath);
    } catch (error) {
      try { await unlink(tmp); } catch { /* preserve the original write error */ }
      throw error;
    }
  }

  /** The settings the console and the pet page both read: switches, numbers and the title filter. */
  #publicSettings() {
    return {
      ...this.#settings,
      minWidth: Number(this.#cfg.minWidth ?? 240),
      minHeight: Number(this.#cfg.minHeight ?? 120),
      headroom: Number(this.#cfg.headroom ?? 56),
      excludeTitles: [...(this.#cfg.excludeTitles ?? [])],
    };
  }

  /** Persist a panel-changed setting into `worlds.perch` so it survives a restart. */
  #persistSetting(patch) {
    try { this.#ctx?.persist?.(patch); } catch (err) { this.#log?.warn?.(`perch: could not persist ${JSON.stringify(patch)}: ${err?.message ?? err}`); }
  }

  /**
   * Turn a request into a physical point on the active screen. `null` means "let the pet choose",
   * which now always lands away from where it stands instead of straight up.
   */
  #resolveTarget(input = {}) {
    const screen = this.#activeScreen();
    const area = screen.work;
    const mode = typeof input?.mode === 'string' ? input.mode : '';
    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    const hasPoint = Number.isFinite(Number(input?.x)) && Number.isFinite(Number(input?.y));
    if (mode === 'floor') return { mode: 'floor', label: '桌面底部' };
    if (title || mode === 'window') {
      if (!title) throw new Error('按窗口跳需要提供 title');
      const hit = this.#platforms(area, screen).find((p) => String(p.title ?? '').toLowerCase().includes(title.toLowerCase()));
      if (!hit) throw new Error(`没有标题包含「${title}」的可站立窗口`);
      const span = [...(hit.spans ?? [])].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] ?? [area.x, area.x + area.width];
      const want = Number.isFinite(Number(input.x)) ? area.x + clampNumber(input.x, 0.5, 0, 1) * area.width : (span[0] + span[1]) / 2;
      return {
        mode: 'window',
        label: hit.title,
        point: { x: Math.round(Math.max(span[0] + 40, Math.min(span[1] - 40, want))), y: Math.round(hit.y) },
      };
    }
    if (mode === 'point' || hasPoint) {
      if (!Number.isFinite(Number(input?.x)) || !Number.isFinite(Number(input?.y))) throw new Error('指定落点需要同时提供 x 和 y');
      return {
        mode: 'point',
        label: '指定落点',
        point: {
          x: Math.round(area.x + clampNumber(input.x, 0.5, 0, 1) * area.width),
          y: Math.round(area.y + clampNumber(input.y, area.height / 2, 0, area.height)),
        },
      };
    }
    return { mode: 'auto', label: '其他窗口顶面' };
  }

  /** The window tops the AI or a person can name, for picking a destination. */
  #targetList() {
    const screen = this.#activeScreen();
    return this.#platforms(screen.work, screen).map((p) => ({
      title: p.title,
      y: p.y,
      width: Math.round((p.spans ?? []).reduce((n, [a, b]) => n + (b - a), 0)),
    })).slice(0, 24);
  }

  #rememberScreen() {
    const state = this.#state;
    if (!state || !Number.isFinite(Number(state.x)) || !Number.isFinite(Number(state.y))) return;
    // Pet coordinates are CSS pixels inside the overlay. Convert them back to the virtual
    // screen before selecting a monitor; this matters when the monitor origin is negative.
    const s = state.screen;
    const scale = Number(s?.scaleFactor) > 0 ? Number(s.scaleFactor) : 1;
    const gx = Number(s?.x ?? 0) + Number(state.x) * scale;
    const gy = Number(s?.y ?? 0) + Number(state.y) * scale;
    this.#screen = displayAt(gx, gy);
  }

  #activeScreen() {
    this.#rememberScreen();
    const screens = displayWorkAreas();
    if (this.#screen) {
      const fresh = screens.find((d) => d.id === this.#screen.id);
      if (fresh) return fresh;
    }
    return screens.find((d) => d.primary) ?? screens[0];
  }

  #panelState() {
    const screen = this.#activeScreen();
    const area = screen.work;
    const platforms = this.#paused ? [] : this.#platforms(area);
    return {
      paused: this.#paused,
      pet: this.#state,
      screen: { id: screen.id, x: screen.x, y: screen.y, width: screen.width, height: screen.height, primary: screen.primary },
      area,
      settings: this.#publicSettings(),
      prompt: this.#promptState(),
      lastPick: this.#state?.pick ?? null,
      lastJump: this.#state?.jump ?? null,
      lastRoam: this.#state?.roam ?? null,
      diag: this.#state?.diag ?? null,
      debug: this.#state?.debug ?? null,
      platforms: platforms.map((p) => ({
        y: p.y,
        width: Math.round((p.spans ?? []).reduce((n, [a, b]) => n + (b - a), 0)),
        title: p.title,
      })),
    };
  }

  /**
   * The terrain the pet page reads. Only a request that asks to take (`?take=1`, the pet page)
   * consumes a pending command: a status read, the console's poll or a probe used to be able to
   * swallow a jump before the page ever saw it. A command also expires, so a page that was not
   * there cannot make the pet jump minutes later.
   */
  #snapshot(consume = false, who = '') {
    const screen = this.#activeScreen();
    const area = screen.work;
    const platforms = this.#platforms(area, screen);
    if (this.#pending && Date.now() - this.#pendingAt > 5000) this.#pending = null;
    const pending = this.#pending;
    if (consume) this.#pending = null;
    if (consume && pending) this.#log?.info?.(`perch: order taken (${who}) ${JSON.stringify(pending)}`);
    const command = pending?.kind === 'hop'
      ? { command: 'hop', target: pending.target, apex: pending.apex, label: pending.label ?? null }
      : pending;
    // full rectangles, topmost first: dropping the pet over a window puts it on that window's top
    const rects = windows()
      .map((w) => ({
        x0: Math.max(w.x, area.x), y0: w.y,
        x1: Math.min(w.x + w.width, area.x + area.width), y1: w.y + w.height,
        title: w.title,
      }))
      .filter((r) => r.x1 - r.x0 > 60 && r.y1 - r.y0 > 40)
      .slice(0, 24);
    return {
      area,
      screen: { id: screen.id, x: screen.x, y: screen.y, width: screen.width, height: screen.height, primary: screen.primary },
      platforms: this.#settings.windowPerching ? platforms : [],
      rects,
      state: this.#state,
      settings: this.#publicSettings(),
      command,
    };
  }

  /**
   * Window tops the pet may stand on, each reduced to the x spans that are actually visible:
   * a window above this one that crosses its top edge covers that part, and the pet walks (and
   * falls) only where the edge is really there.
   */
  #platforms(area) {
    if (this.#paused || this.#settings.windowPerching === false) return [];
    const exclude = (this.#cfg.excludeTitles ?? []).map((t) => String(t).toLowerCase()).filter(Boolean);
    const minWidth = Number(this.#cfg.minWidth ?? 240);
    const minHeight = Number(this.#cfg.minHeight ?? 120);
    // a window whose top edge is this close to the top of the work area leaves no room for the
    // pet's body above it, so its top surface cannot be stood on
    const headroom = Number(this.#cfg.headroom ?? 56);
    const all = windows();
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const w = all[i];
      if (w.width < minWidth || w.height < minHeight) continue;
      if (exclude.some((t) => w.title.toLowerCase().includes(t))) continue;
      if (w.y - area.y < headroom) continue;
      // a window that covers the whole work area would put the pet at the very top edge
      if (w.width * w.height >= area.width * area.height * 0.9) continue;
      let spans = [[Math.max(w.x, area.x), Math.min(w.x + w.width, area.x + area.width)]];
      // `all` is in z-order, topmost first: everything before i paints over this window
      for (let j = 0; j < i && spans.length; j++) {
        const above = all[j];
        if (w.y < above.y || w.y > above.y + above.height) continue;
        spans = subtractSpan(spans, above.x, above.x + above.width);
      }
      spans = spans.filter(([a, b]) => b - a >= 60);
      if (!spans.length) continue;
      // `id` and `x0` let the pet ride a window that is being dragged; `spans` is what it may walk on
      out.push({ id: w.handle, y: w.y, x0: w.x, spans, title: w.title });
    }
    out.sort((a, b) => a.y - b.y);
    return out;
  }

  /**
   * Queues one order for the pet page. `ignoreCooldown` is for the console's own button: the
   * cooldown exists to keep the AI from spamming jumps, not to refuse a person's click.
   */
  async #command(kind, options = {}) {
    const { ignoreCooldown = false, ...rest } = options;
    const now = Date.now();
    if (kind === 'hop' && !ignoreCooldown && this.#settings.jumpCooldown > 0 && now - this.#lastJumpCommandAt < this.#settings.jumpCooldown * 1000) return false;
    this.#pending = { kind, ...rest };
    this.#pendingAt = now;
    this.#log?.info?.(`perch: order queued ${kind} ${JSON.stringify(rest)}`);
    if (kind === 'hop') this.#lastJumpCommandAt = now;
    return true;
  }

  async #launch(host) {
    const url = `http://127.0.0.1:${this.#port}/`;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    const args = ['--pet-host', `--pet-url=${url}`, `--parent-pid=${process.pid}`];
    const child = spawn(process.execPath, args, { env, stdio: 'ignore', windowsHide: true });
    this.#child = child;
    child.on('error', (err) => host?.log?.warn?.(`perch: cannot start the window host: ${err.message}`));
    child.on('exit', (code) => {
      host?.log?.warn?.(`perch: window host exited (${code})`);
      this.#child = null;
      // the host can die with the display; bring it back while the World is still running
      if (!this.#stopped) void sleep(5000).then(() => { if (!this.#stopped && !this.#child) void this.#launch(host); });
    });
  }

  async #handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    // the desktop pet's page lives on another origin and polls /api/terrain
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, x-perch-page, x-perch-host');
    // A JSON POST from the pet page is not a simple request: the browser asks with OPTIONS first,
    // and without this header it refuses to send the POST at all — the World then never learns
    // where the pet is and measures every window top against the wrong display.
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      if (url.pathname === '/api/terrain' || url.pathname === '/api/platforms') {
        const now = Date.now();
        if (!this.#lastAskAt || now - this.#lastAskAt > 10_000) {
          this.#lastAskAt = now;
          this.#log?.info?.(`perch: terrain asked (${url.pathname}${url.search})`);
        }
        const take = url.searchParams.get('take') === '1';
        const page = String(req.headers['x-perch-page'] ?? '-');
        const isWindow = String(req.headers['x-perch-host'] ?? '-');
        if (take && (this.#lastTakeLogAt === 0 || now - this.#lastTakeLogAt > 5000)) {
          this.#lastTakeLogAt = now;
          this.#log?.info?.(`perch: take client page=${page} window=${isWindow} origin=${req.headers.origin ?? '-'}`);
        }
        return json(res, this.#snapshot(take, `page=${page} window=${isWindow}`));
      }
      if (url.pathname === '/api/pet' && req.method === 'POST') {
        this.#state = await body(req);
        const page = this.#state?.page ?? null, why = this.#state?.why ?? '';
        if (page !== this.#lastPetPage || why !== this.#lastPetWhy) {
          this.#lastPetPage = page;
          this.#lastPetWhy = why;
          this.#log?.info?.(`perch: pet report page=${page ?? '-'}${why ? ` — no position (${why})` : ''}`);
        }
        this.#rememberScreen();
        return json(res, { ok: true });
      }
      if (url.pathname === '/api/state' && req.method === 'POST') {
        this.#state = await body(req);
        this.#rememberScreen();
        return json(res, { ok: true });
      }
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (rel.includes('..')) return fail(res, 400);
      const file = join(WEB, rel);
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch (error) {
      fail(res, error?.code === 'ENOENT' ? 404 : 500);
    }
  }
}

/** `spans` with `[a, b)` cut out. */
function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function subtractSpan(spans, a, b) {
  const out = [];
  for (const [x0, x1] of spans) {
    if (b <= x0 || a >= x1) { out.push([x0, x1]); continue; }
    if (a > x0) out.push([x0, a]);
    if (b < x1) out.push([b, x1]);
  }
  return out;
}

function json(res, value) {
  const text = JSON.stringify(value);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function fail(res, status) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(String(status));
}

function body(req) {
  return new Promise((done, fail) => {
    let text = '';
    req.on('data', (chunk) => { text += chunk; if (text.length > 64_000) { fail(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { done(JSON.parse(text || 'null')); } catch (e) { fail(e); } });
    req.on('error', fail);
  });
}
