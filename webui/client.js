/**
 * The console panel for the perch World.
 *
 * Everything the plugin does is listed here as a switch or a number: window perching, edge leaps,
 * automatic hops, roaming jumps, the AI thunder jump, the window-size filters, jump height and
 * cooldown, and the title filter. "Apply" writes the whole form in one call, which the World
 * persists into `worlds.perch` and applies live.
 */

const fallback = {
  h: (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  },
  button: (label, onClick) => {
    const el = fallback.h('button', 'perch-btn', label);
    el.addEventListener('click', onClick);
    return el;
  },
  msgline: (text) => fallback.h('div', 'perch-msg', text),
  sheet: (o) => fallback.h('div', 'perch-sheet', o?.title ?? ''),
};

/** The switches, in the order the panel shows them. */
const FEATURES = [
  { key: 'windowPerching', zh: '站在窗口顶面', en: 'Window perching', zhHint: '把窗口上沿当成可以站立的地面', enHint: 'Window tops act as ground' },
  { key: 'edgeLeaps', zh: '边缘跳跃', en: 'Edge leaps', zhHint: '走到窗口边缘时跳向其他窗口或桌面，而不是掉下去', enHint: 'Leap off edges instead of dropping' },
  { key: 'autoWindowHops', zh: '自动跳窗', en: 'Automatic window hops', zhHint: '空闲时自己跳上更高的窗口顶面', enHint: 'Hop up to window tops on her own' },
  { key: 'autoRoamingJumps', zh: '闲逛位移跳', en: 'Roaming jumps travel', zhHint: '闲逛时的跳跃会真正移动位置，而不是原地弹跳', enHint: 'Idle jumps cover ground' },
  { key: 'aiThunderJump', zh: 'AI 雷霆大跳', en: 'AI thunder jump', zhHint: '允许 AI 与控制面板触发大跳', enHint: 'Let the AI and this panel trigger jumps' },
];

/** The numeric parameters: key, labels, range and unit. */
const NUMBERS = [
  { key: 'minWidth', zh: '最小窗口宽度', en: 'Min window width', min: 80, max: 2000, step: 10, unit: 'px' },
  { key: 'minHeight', zh: '最小窗口高度', en: 'Min window height', min: 60, max: 2000, step: 10, unit: 'px' },
  { key: 'headroom', zh: '顶部留空', en: 'Top headroom', min: 0, max: 500, step: 4, unit: 'px' },
  { key: 'maxJumpHeight', zh: '最大跳跃高度', en: 'Max jump height', min: 70, max: 2000, step: 10, unit: 'px' },
  { key: 'jumpCooldown', zh: '跳跃冷却（AI）', en: 'Jump cooldown (AI)', min: 0, max: 120, step: 1, unit: 's' },
];

export default {
  panels: {
    perch: {
      mount(ctx) {
        const h = (...a) => (ctx.ui?.h ? ctx.ui.h(...a) : fallback.h(...a));
        const button = (label, onClick) => (ctx.ui?.button ? ctx.ui.button(label, { size: 'sm', onClick }) : fallback.button(label, onClick));
        const msgline = (text) => (ctx.ui?.msgline ? ctx.ui.msgline(text) : fallback.msgline(text));
        const sheet = (o) => (ctx.ui?.sheet ? ctx.ui.sheet(o) : fallback.sheet(o));
        const zh = String(ctx.language ?? 'zh').startsWith('zh');

        const root = ctx.root;
        root.classList.add('perch-panel');

        const hint = h('div', 'perch-hint', '');
        const state = { paused: false };
        // once the person touches a control the 1.5s poll stops writing back into the form
        let dirty = false;
        let promptDirty = false;
        let windowKeys = '';

        /* ---------- "make the real Coo stand on windows" (one-click compat patch) ---------- */
        const compatSection = h('div', 'perch-section perch-compat');
        compatSection.append(h('div', 'perch-section-title', zh ? '让真正的 Coo 站上窗口顶' : 'Make the real Coo perch'));
        const compatStatus = h('div', 'perch-compat-status', zh ? '检测中…' : 'Checking…');
        const compatNote = h('div', 'perch-section-note', zh
          ? '会修改 Coopanion 安装目录里的 7 个文件（自动备份为 .perch-orig，可随时还原），改完需重启 Coopanion。'
          : 'Changes 7 files inside the Coopanion install (each backed up as .perch-orig and restorable); restart Coopanion afterwards.');
        const compatActions = h('div', 'perch-actions');
        const btnCompat = button(zh ? '应用兼容补丁' : 'Apply patch', () => void applyCompat());
        const btnCompatRevert = button(zh ? '还原内置桌宠' : 'Restore', () => void revertCompat());
        compatActions.append(btnCompat, btnCompatRevert);
        compatSection.append(compatStatus, compatActions, compatNote);

        /* ---------- switches ---------- */
        const switches = new Map();
        const featureSection = h('div', 'perch-section');
        featureSection.append(h('div', 'perch-section-title', zh ? '功能开关' : 'Features'));
        for (const f of FEATURES) {
          const row = h('label', 'perch-toggle');
          const box = h('input', 'perch-check');
          box.type = 'checkbox';
          const text = h('span', 'perch-toggle-text', zh ? f.zh : f.en);
          const sub = h('span', 'perch-toggle-hint', zh ? f.zhHint : f.enHint);
          text.append(sub);
          row.append(box, text);
          box.addEventListener('change', markDirty);
          featureSection.append(row);
          switches.set(f.key, box);
        }

        /* ---------- numbers ---------- */
        const numbers = new Map();
        const numberSection = h('div', 'perch-section');
        numberSection.append(h('div', 'perch-section-title', zh ? '参数' : 'Parameters'));
        const grid = h('div', 'perch-fields');
        for (const n of NUMBERS) {
          const field = h('label', 'perch-field');
          const cap = h('span', 'perch-field-cap', `${zh ? n.zh : n.en} (${n.unit})`);
          const input = h('input', 'perch-input');
          input.type = 'number';
          input.min = String(n.min);
          input.max = String(n.max);
          input.step = String(n.step);
          input.addEventListener('input', markDirty);
          field.append(cap, input);
          grid.append(field);
          numbers.set(n.key, input);
        }
        numberSection.append(grid);

        /* ---------- title filter ---------- */
        const filterSection = h('div', 'perch-section');
        filterSection.append(h('div', 'perch-section-title', zh ? '排除的窗口标题' : 'Excluded window titles'));
        const titles = h('textarea', 'perch-titles');
        titles.rows = 2;
        titles.placeholder = zh ? '每行一个关键词，例如：任务管理器' : 'One keyword per line';
        titles.addEventListener('input', markDirty);
        filterSection.append(titles, h('div', 'perch-section-note', zh ? '标题里含这些关键词的窗口不会被当作平台' : 'Windows whose title contains these are ignored'));

        /* ---------- jump destination ---------- */
        const targetSection = h('div', 'perch-section');
        targetSection.append(h('div', 'perch-section-title', zh ? '雷霆大跳的落点' : 'Thunder jump destination'));
        const targetMode = h('select', 'perch-input perch-select');
        for (const [value, label] of [
          ['auto', zh ? '自动（其他窗口顶面）' : 'Automatic (another window top)'],
          ['window', zh ? '指定窗口顶面' : 'A window top'],
          ['point', zh ? '屏幕坐标' : 'Screen point'],
          ['floor', zh ? '桌面底部' : 'Desktop floor'],
        ]) {
          const opt = h('option', null, label);
          opt.value = value;
          targetMode.append(opt);
        }
        const targetWindow = h('select', 'perch-input perch-select');
        const targetX = h('input', 'perch-input');
        targetX.type = 'number'; targetX.min = '0'; targetX.max = '100'; targetX.step = '1'; targetX.value = '50';
        const targetY = h('input', 'perch-input');
        targetY.type = 'number'; targetY.min = '0'; targetY.max = '4000'; targetY.step = '10'; targetY.value = '500';
        const targetGrid = h('div', 'perch-fields');
        const modeField = h('label', 'perch-field');
        modeField.append(h('span', 'perch-field-cap', zh ? '方式' : 'Mode'), targetMode);
        const winField = h('label', 'perch-field');
        winField.append(h('span', 'perch-field-cap', zh ? '窗口' : 'Window'), targetWindow);
        const xField = h('label', 'perch-field');
        xField.append(h('span', 'perch-field-cap', zh ? '横向位置 (%)' : 'Horizontal (%)'), targetX);
        const yField = h('label', 'perch-field');
        yField.append(h('span', 'perch-field-cap', zh ? '距屏幕顶部 (px)' : 'From screen top (px)'), targetY);
        targetGrid.append(modeField, winField, xField, yField);
        const targetNote = h('div', 'perch-section-note', zh ? '「自动」一定会跳到别处，不会原地起跳。' : 'Automatic always lands somewhere else, never on the spot.');
        targetSection.append(targetGrid, targetNote);

        const syncTargetFields = () => {
          const mode = targetMode.value;
          winField.style.display = mode === 'window' ? '' : 'none';
          xField.style.display = mode === 'point' || mode === 'window' ? '' : 'none';
          yField.style.display = mode === 'point' ? '' : 'none';
        };
        targetMode.addEventListener('change', syncTargetFields);
        syncTargetFields();

        /* ---------- editable system prompt template ---------- */
        const promptSection = h('div', 'perch-section perch-prompt-section');
        promptSection.append(h('div', 'perch-section-title', zh ? '系统提示词模板' : 'System prompt template'));
        const promptNote = h('div', 'perch-prompt-note', zh ? '这是实际发给 AI 的雷霆大跳环境提示词。支持 {{maxJumpHeight}} 和 {{jumpCooldown}} 变量。' : 'This is the actual perch environment prompt sent to the AI. Supports {{maxJumpHeight}} and {{jumpCooldown}}.');
        const prompt = h('textarea', 'perch-prompt');
        prompt.rows = 9;
        prompt.spellcheck = false;
        prompt.placeholder = zh ? '输入雷霆大跳系统提示词模板…' : 'Enter the perch system prompt template…';
        const promptActions = h('div', 'perch-prompt-actions');
        const btnPromptLoad = button(zh ? '加载模板' : 'Load template', () => void loadPrompt());
        const btnPromptSave = button(zh ? '应用模板' : 'Apply template', () => void savePrompt());
        const btnPromptReset = button(zh ? '恢复默认模板' : 'Restore default template', () => void resetPrompt());
        promptActions.append(btnPromptLoad, btnPromptSave, btnPromptReset);
        prompt.addEventListener('input', () => { promptDirty = true; promptNote.textContent = zh ? '模板有未保存修改' : 'Template has unsaved changes'; promptNote.classList.add('perch-prompt-note-dirty'); });
        promptSection.append(prompt, promptNote, promptActions);

        /* ---------- actions ---------- */
        const actions = h('div', 'perch-actions');
        const btnApply = button(zh ? '应用' : 'Apply', () => void apply());
        const btnDefaults = button(zh ? '恢复默认' : 'Defaults', () => void resetDefaults());
        const btnHop = button(zh ? '雷霆大跳' : 'Thunder jump', () => void hop());
        const btnPause = button(zh ? '暂停' : 'Pause', () => void togglePause());
        const btnRefresh = button(zh ? '刷新' : 'Refresh', () => void refresh());
        actions.append(btnApply, btnDefaults, btnHop, btnPause, btnRefresh);

        root.append(sheet({ title: zh ? '雷霆大跳' : 'Thunder Jump', en: 'Thunder Jump' }), hint, compatSection, featureSection, numberSection, filterSection, targetSection, promptSection, actions);

        function markDirty() {
          dirty = true;
          hint.textContent = zh ? '有未应用的修改' : 'Unapplied changes';
          hint.classList.add('perch-hint-dirty');
        }

        function clearDirty() {
          dirty = false;
          hint.textContent = '';
          hint.classList.remove('perch-hint-dirty');
        }

        function render(d) {
          state.paused = !!d?.paused;
          const s = d?.settings ?? {};

          btnPause.textContent = state.paused ? (zh ? '恢复' : 'Resume') : (zh ? '暂停' : 'Pause');

          // never overwrite what the person is editing
          if (!dirty) {
            for (const f of FEATURES) {
              const box = switches.get(f.key);
              if (box) box.checked = s[f.key] !== false;
            }
            for (const n of NUMBERS) {
              const input = numbers.get(n.key);
              if (input && s[n.key] != null && document.activeElement !== input) input.value = String(s[n.key]);
            }
            if (document.activeElement !== titles && Array.isArray(s.excludeTitles)) titles.value = s.excludeTitles.join('\n');
          }
          const p = d?.prompt;
          if (!promptDirty && p && typeof p.content === 'string' && document.activeElement !== prompt) {
            prompt.value = p.content;
            promptNote.textContent = p.hasOverride
              ? (zh ? '已加载部署覆盖模板' : 'Deployment override loaded')
              : (zh ? '已加载默认模板' : 'Default template loaded');
            promptNote.classList.remove('perch-prompt-note-dirty');
          }

          // the destination picker follows the window tops on the screen the pet is on
          const platformsNow = d?.platforms ?? [];
          const keys = platformsNow.map((p) => `${p.title}@${p.y}`).join('|');
          if (keys !== windowKeys) {
            const keep = targetWindow.value;
            windowKeys = keys;
            targetWindow.replaceChildren();
            if (!platformsNow.length) {
              const opt = h('option', null, zh ? '当前没有可站立窗口' : 'No window tops right now');
              opt.value = '';
              targetWindow.append(opt);
            }
            for (const p of platformsNow) {
              const opt = h('option', null, `${p.title} (y=${p.y})`);
              opt.value = p.title;
              targetWindow.append(opt);
            }
            if (keep && platformsNow.some((p) => p.title === keep)) targetWindow.value = keep;
          }
          const lj = d?.lastJump;
          if (lj && lj.ok === false) {
            hint.textContent = zh
              ? `上一次大跳没有被接受${lj.err ? `：${lj.err}` : ''}${lj.mode ? `（当时 ${lj.mode}）` : ''}`
              : `The last jump was declined${lj.err ? `: ${lj.err}` : ''}${lj.mode ? ` (mode ${lj.mode})` : ''}`;
            hint.classList.add('perch-hint-dirty');
          }

        }

        function formValues() {
          const out = { excludeTitles: titles.value.split(/[\n,]/).map((v) => v.trim()).filter(Boolean) };
          for (const f of FEATURES) out[f.key] = !!switches.get(f.key)?.checked;
          for (const n of NUMBERS) out[n.key] = Number(numbers.get(n.key)?.value);
          return out;
        }

        async function apply() {
          try {
            await ctx.invoke('applyAll', [formValues()]);
            clearDirty();
            hint.textContent = zh ? '已应用' : 'Applied';
            await load();
          } catch (error) {
            hint.textContent = error instanceof Error ? error.message : String(error);
            hint.classList.add('perch-hint-dirty');
          }
        }

        async function resetDefaults() {
          try {
            await ctx.invoke('defaults');
            clearDirty();
            hint.textContent = zh ? '已恢复默认' : 'Restored defaults';
            await load();
          } catch (error) {
            hint.textContent = error instanceof Error ? error.message : String(error);
          }
        }

        function renderCompat(c) {
          if (!c || c.found === false) {
            compatStatus.textContent = c?.reason
              ? c.reason
              : (zh ? '没找到 Coopanion 内置桌宠' : 'Built-in desktop pet not found');
            compatStatus.classList.add('perch-compat-warn');
            btnCompat.disabled = true;
            btnCompatRevert.disabled = true;
            return;
          }
          const total = c.total ?? 0;
          const done = c.patched ?? 0;
          if (done >= total && total > 0) {
            compatStatus.textContent = zh
              ? `已应用 ${done}/${total}，重启 Coopanion 后生效`
              : `Applied ${done}/${total}; restart Coopanion to take effect`;
            compatStatus.classList.remove('perch-compat-warn');
          } else if (done > 0) {
            compatStatus.textContent = zh ? `部分应用 ${done}/${total}，建议还原后重试` : `Partly applied ${done}/${total}; restore and retry`;
            compatStatus.classList.add('perch-compat-warn');
          } else {
            compatStatus.textContent = zh
              ? '未应用：现在只有地形和面板，Coo 不会站上窗口顶'
              : 'Not applied: terrain and panel only; Coo does not perch yet';
            compatStatus.classList.add('perch-compat-warn');
          }
          compatStatus.title = c.dir ?? '';
          btnCompat.disabled = done >= total && total > 0;
          btnCompatRevert.disabled = done === 0;
        }

        async function loadCompat() {
          try { renderCompat(await ctx.invoke('compat')); }
          catch (error) {
            compatStatus.textContent = error instanceof Error ? error.message : String(error);
            compatStatus.classList.add('perch-compat-warn');
          }
        }

        async function applyCompat() {
          btnCompat.disabled = true;
          compatStatus.textContent = zh ? '正在写入…' : 'Writing…';
          try {
            const r = await ctx.invoke('applyCompat');
            const bad = (r?.results ?? []).filter((x) => x.state === 'mismatch' || x.state === 'failed');
            if (r?.ok) {
              compatStatus.textContent = zh ? '补丁已写入，重启 Coopanion 后生效' : 'Patch written; restart Coopanion';
              compatStatus.classList.remove('perch-compat-warn');
            } else {
              compatStatus.textContent = zh
                ? `部分文件不匹配（${bad.map((b) => b.rel).join('、')}）：这个 Coopanion 版本与补丁不同，已跳过这些文件`
                : `Some files do not match (${bad.map((b) => b.rel).join(', ')}): this Coopanion differs, those were skipped`;
              compatStatus.classList.add('perch-compat-warn');
            }
          } catch (error) {
            compatStatus.textContent = error instanceof Error ? error.message : String(error);
            compatStatus.classList.add('perch-compat-warn');
          }
          await loadCompat();
        }

        async function revertCompat() {
          try {
            const r = await ctx.invoke('revertCompat');
            const rows = r?.results ?? [];
            if (r?.ok) {
              compatStatus.textContent = zh ? '已还原，重启 Coopanion 后回到原样' : 'Restored; restart Coopanion';
            } else if (rows.length && rows.every((x) => x.state === 'no-backup')) {
              compatStatus.textContent = zh
                ? '这些文件不是本面板改的（没有 .perch-orig 备份），无法从这里还原'
                : 'These files were not changed by this panel (no .perch-orig backup), so they cannot be restored here';
            } else {
              compatStatus.textContent = zh ? '还原未完全成功，请看日志' : 'Restore was incomplete; check the log';
            }
          } catch (error) {
            compatStatus.textContent = error instanceof Error ? error.message : String(error);
          }
          await loadCompat();
        }

        async function loadPrompt() {
          try {
            const result = await ctx.invoke('prompt');
            if (result && typeof result.content === 'string') prompt.value = result.content;
            promptDirty = false;
            promptNote.textContent = result?.hasOverride
              ? (zh ? '已加载部署覆盖模板' : 'Deployment override loaded')
              : (zh ? '已加载默认模板' : 'Default template loaded');
            promptNote.classList.remove('perch-prompt-note-dirty');
          } catch (error) {
            promptNote.textContent = error instanceof Error ? error.message : String(error);
            promptNote.classList.add('perch-prompt-note-dirty');
          }
        }

        async function savePrompt() {
          try {
            const result = await ctx.invoke('setPrompt', [prompt.value]);
            promptDirty = false;
            promptNote.textContent = zh ? '模板已保存，下一轮系统提示词会使用新内容' : 'Template saved; the next system prompt uses it';
            promptNote.classList.remove('perch-prompt-note-dirty');
            if (result?.content && prompt.value !== result.content) prompt.value = result.content;
          } catch (error) {
            promptNote.textContent = error instanceof Error ? error.message : String(error);
            promptNote.classList.add('perch-prompt-note-dirty');
          }
        }

        async function resetPrompt() {
          try {
            const result = await ctx.invoke('resetPrompt');
            promptDirty = false;
            prompt.value = result?.content ?? '';
            promptNote.textContent = zh ? '已恢复默认模板' : 'Default template restored';
            promptNote.classList.remove('perch-prompt-note-dirty');
          } catch (error) {
            promptNote.textContent = error instanceof Error ? error.message : String(error);
            promptNote.classList.add('perch-prompt-note-dirty');
          }
        }

        async function hop() {
          try {
            // the destination the panel names; empty means she picks a spot away from herself
            const payload = { mode: targetMode.value };
            if (payload.mode === 'window') {
              payload.title = targetWindow.value;
              payload.x = Number(targetX.value) / 100;
            } else if (payload.mode === 'point') {
              payload.x = Number(targetX.value) / 100;
              payload.y = Number(targetY.value);
            }
            const res = await ctx.invoke('hop', [payload]);
            if (res && res.ok === false) {
              hint.textContent = res.disabled
                ? (zh ? '大跳已在开关里关闭' : 'Thunder jump is switched off')
                : res.error
                  ? res.error
                  : (zh ? '暂时无法起跳：她可能正在空中或被拖动' : 'Cannot jump right now: airborne or being dragged');
              hint.classList.add('perch-hint-dirty');
            } else {
              hint.textContent = res?.target?.label
                ? (zh ? `已发出大跳 → ${res.target.label}` : `Jump sent → ${res.target.label}`)
                : (zh ? '已发出大跳' : 'Jump sent');
              hint.classList.remove('perch-hint-dirty');
            }
            await load();
          } catch (error) {
            hint.textContent = error instanceof Error ? error.message : String(error);
          }
        }

        async function togglePause() {
          try {
            await ctx.invoke(state.paused ? 'resume' : 'pause');
            await load();
          } catch (error) {
            hint.textContent = error instanceof Error ? error.message : String(error);
          }
        }

        async function refresh() {
          clearDirty();
          await load();
        }

        async function load() {
          try { render(await ctx.invoke('state')); }
          catch (error) { hint.textContent = error instanceof Error ? error.message : String(error); hint.classList.add('perch-hint-dirty'); }
        }

        void load();
        void loadCompat();
        ctx.interval(() => { void load(); }, 1500);
      },
    },
  },
};
