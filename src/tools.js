/**
 * The tools this World offers, as one declaration list.
 *
 * `world.js` binds the handlers and `index.js` exports the same list as the package's
 * self-description, so `describe.json` (generated from it) can never drift from what the
 * model actually receives.
 */

export const PERCH_TOOLS = [
  {
    name: 'perch_status',
    description: 'Where the window-perching companion is right now: the platforms it can stand on and what it is standing on.',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    summary: { zh: '看 Coo 现在站在哪个窗口上、附近有哪些窗口顶面', en: 'Where the pet stands and which window tops are nearby' },
  },
  {
    name: 'perch_hop',
    description: '雷霆大跳：让 Coo 跳向别处。不指定目标时自动跳到另一个窗口顶面或桌面底部（一定有水平位移，不是原地跳）。'
      + '可以用 title 指定窗口标题的一段文字（落在该窗口顶面），或用 x(0~1 屏幕宽度比例) + y(距屏幕顶部的像素) 指定确切落点。'
      + 'height 是额外抬升高度，不能超过插件设置的最大跳跃高度。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '目标窗口标题里的片段，落在该窗口顶面。' },
        x: { type: 'number', minimum: 0, maximum: 1, description: '落点横向位置，0 = 屏幕最左，1 = 最右（屏幕宽度比例）。' },
        y: { type: 'number', minimum: 0, maximum: 4000, description: '落点距屏幕顶部的像素；与 x 一起使用。' },
        mode: { type: 'string', enum: ['auto', 'window', 'floor', 'point'], description: 'auto=自动选窗口，floor=桌面底部，window=按 title，point=按 x/y。' },
        height: { type: 'number', minimum: 70, maximum: 2000 },
      },
    },
    summary: { zh: '让 Coo 雷霆大跳：自动跳到别的窗口，或按标题 / 坐标指定落点', en: 'Thunder jump to another window, or to a window title / screen point' },
  },
];
