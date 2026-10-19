# cortico-world-perch · 雷霆大跳

一个让桌宠**站在任意窗口的顶面之上**、并在散步时**雷霆大跳**到别的窗口或桌面底部的 World 扩展。支持多屏幕，也可以指定跳到哪个窗口或屏幕上的哪一点。

## 前提（请先读这一段）

雷霆大跳提供的是**地形**：窗口顶边在哪里、多高、多宽，以及一个「跳到这里」的命令。真正让 Coo 站上去、跳起来的物理，在 Coopanion 内置的桌宠 World（`cortico-world-desktop-pet`）里。因此分两种用法：

| 模式 | 谁在屏幕上走 | 需要什么 |
|---|---|---|
| `attach`（默认） | 你自己的 Coo（桌宠 World 的页面） | 在控制面板点一次 **应用兼容补丁**（见下），然后重启 Coopanion |
| `window` | 插件自带的覆盖窗（`web/app.js` 画的小人） | 什么都不用改：插件自己开一个透明置顶窗，物理和绘制都在包内 |

### 一键兼容补丁（attach 的开箱即用路径）

内置桌宠的页面属于 Coopanion 本体，扩展装不进去，所以 `attach` 需要往它里面放一小段「读地形 + 接跳跃命令」的钩子。面板顶部有 **应用兼容补丁**：

- 改 7 个文件：`src/server.ts`、`web/pet-app.js`、`web/kit/body.js`、`web/body-host.js`、`web/figure-frame.js`、`host/preload.cjs`、`host/electron-main.cjs`
- 每个文件先备份成 `<文件名>.perch-orig`，**还原内置桌宠** 一键复原
- 只在文件内容与补丁预期完全一致时才写入；版本不同就跳过并告诉你，不会把文件改成半截
- 面板显示 `已应用 7/7 · 重启 Coopanion 后生效`
- Coopanion 升级会覆盖这些文件，升级后重新点一次即可

补丁内容就是本仓库 `patch/` 下的 3 个 diff + 4 段插入代码，`node scripts/test-patch.mjs` 会在临时副本上验证：应用后与作者验证过的版本逐字节一致、重复应用幂等、还原后与原始版本一致。

## 它怎么工作

```
Win32 枚举顶层窗口 (koffi)  ──►  World 每 0.5s 提供平台表
                                      │
Coopanion.exe --pet-host ◄────────────┘  （透明、置顶、鼠标穿透的覆盖窗）
        │
        └─► 页面自己跑物理：重力、走动、抛物线大跳、落地判定、绘制
```

- **平台** = 每个可见、未最小化、有标题的顶层窗口的**上沿**（`y = 窗口顶边`），加上桌面工作区底边
- 角色"脚"踩在平台线上，身体画在平台上方——所以它看起来是站在窗口顶上
- 大跳用抛物线求解：顶点放在起点与落点中较高者之上，落点取目标平台中心（太远则取靠近的一侧边缘）。能从 1036 一跳到 y=100

## 过滤规则（避免站不住的地方）

| 规则 | 原因 |
|---|---|
| `y < headroom(56)` 跳过 | 窗口顶边太靠屏幕顶端，身体没地方站 |
| 面积 ≥ 工作区 90% 跳过 | 最大化窗口的顶面就是屏幕顶边 |
| 宽 < 240 或高 < 120 跳过 | 太窄的窗口站不住、落点不准 |
| 工具窗口 / 隐身窗口 / 无标题 跳过 | 属性表、后台 UWP、以及**它自己的覆盖窗** |
| 只取 Coo 所在显示器 | 让落点与地板跟当前屏幕一致，见「多屏幕」 |

## 配置

`<数据目录>/home/companion/config.json` 的 `worlds.perch`：

```json
{
  "enabled": true,
  "minWidth": 240,
  "minHeight": 120,
  "headroom": 56,
  "excludeTitles": ["任务管理器"]
}
```

`excludeTitles` 是子串匹配（不区分大小写）。

## 工具（给模型用）

| 工具 | 作用 |
|---|---|
| `perch_status` | 返回当前平台列表 + 角色位置 |
| `perch_hop` | 雷霆大跳一次。不指定目标时跳到别的窗口顶面或桌面底部；`title` 指定窗口标题片段；`x`(0~1) + `y`(px) 指定确切落点 |

跳跃命令由桌宠页面独占取走（`/api/terrain?take=1`），状态查询或其它读取方不会再把命令吞掉；命令 5 秒内没被取走就作废。

## 安装 / 卸载

从扩展市场安装，或在本机开发时软链接：

```bash
# 开发：软链接进扩展目录，改完重启 Coopanion 生效
cd "<数据目录>/extensions" && pnpm add link:D:\coopanion-ext\cortico-world-perch
```

- 依赖：`koffi`（Win32 FFI），随 `pnpm add` 自动装
- 卸载：`pnpm remove cortico-world-perch`，并把 `worlds.perch.enabled` 设为 `false`

## 排查

```bash
# 地形接口：platforms 有内容说明窗口枚举正常
curl http://127.0.0.1:47650/api/terrain

# 最近一次大跳的落点（fromX → toX 应该明显不同）
curl -s http://127.0.0.1:47650/api/terrain | grep -o '"pick":{[^}]*}'
```

`state.mode` 是 `walk` / `idle` / `air` / `sleep` 等；面板顶部也会显示「上次落点 x=… y=…（从 x=… 起跳）」，一眼能看出是不是原地跳。

## 模式

| mode | 行为 |
|---|---|
| `attach`（默认） | **不给 Coo 之外的角色**：只提供地形，桌宠本体的 Coo 站到窗口顶上 |
| `window` | 另开一个自己的覆盖窗，跑独立小人（早期实现，保留） |

## 它怎么让 Coo 站上去的

Coo 的竖直位置由形象包 kit（`web/kit/body.js`）拥有，页面只给它 `bounds`。
所以做法是：把"窗口顶边"作为地形塞进 `bounds`，再把 kit 里所有"落到 floorY"的地方换成"落到脚下第一个面"。

### 让内置桌宠接受地形

这些改动全在 Coopanion 安装目录的 `resources/app/node_modules/cortico-world-desktop-pet/` 里，**升级/重装会丢**：

| 文件 | 改动 |
|---|---|
| `src/server.ts` | CSP 的 `connect-src` 放开 `http://127.0.0.1:*`，否则页面拉不到地形 |
| `web/pet-app.js` | 每 0.5s 拉一次 `/api/terrain?take=1`，换算成当前屏幕像素后放进 `bounds.platforms`；处理 `hop` 命令并挑落点 |
| `web/kit/body.js` | 新增 `groundAt` / `platformAt` / `jumpTo` / `hopToReach` / `tryHopUp` / `leapFromEdge`；落地、走动、阴影、吸附全改用它；走出边缘或被遮挡处就转入 `air` 下落 |
| `web/body-host.js`、`web/figure-frame.js` | `thunder-jump` 消息桥：页面 → 形象帧 → body，并把是否接受回传 |
| `host/electron-main.cjs`、`host/preload.cjs` | 把当前覆盖的显示器（物理原点 / 缩放 / 工作区）告诉页面，多屏才换算得对 |

不做这些改动时，`attach` 模式只会提供地形和面板，Coo 本身不会站上窗口顶。

具体语义：

具体语义：

- **落地**：下落时取"脚下方第一个面"，可能是某个窗口的顶边，不再是固定的 floorY
- **走到边缘 = 跳出去**：顶边走到头（或被别的窗口盖住）时，它会朝行进方向**跃向最近的可落点**——另一个窗口顶，或桌面底部；抛物线在空中算好，落点不可达才退化成直接掉落
- **闲逛时跳到别的窗口**：站累了自己挑一个落脚点——另一个窗口顶面（优先）或地板——算好抛物线再起跳；落点与自身至少隔 150px，所以不会原地弹。面板状态行会显示「上次闲逛跳（上窗/跨窗）x=… → x=…」
- **拖动**：把 Coo 拖到窗口**上方**松手，它自由下落，落在该窗口的顶边上（不是吸附，是真掉）
- **窗口被拖动**：它脚下那个窗口平移/上下移动时，Coo 跟着一起走（按窗口 id 追踪位移）
- **窗口上拖到太靠顶部**：顶边被 headroom 规则滤掉时，Coo 会**从原高度摔下去**，不会瞬移到桌面
- **窗口消失/被盖住**：它站着的那块没了 → 掉下去

## 多屏幕

雷霆大跳会根据 Coo 当前所在的显示器选择工作区：Coo 在副屏时只检测副屏可见窗口，移动到另一块屏幕后自动切换窗口列表、地板和坐标原点。显示器左侧或上方的负虚拟屏幕坐标也会正确处理。

- 站在窗口顶上时，Coo 的走动仍受它的「走动频率」设置影响（`calm` 基本是坐着）
- 地形每 0.5s 刷新一次，窗口被拖动的瞬间可能慢半拍

## 控制面板

**位置**：设置窗口 → 高级模式 → 世界页面里的「雷霆大跳」（页面 id `world:perch`，面板 id `perch`）。

面板内容：

- 状态行：Coo 现在的位置、动作、正站在哪个窗口上
- 功能开关：站窗口顶面、边缘跳跃、自动跳窗、闲逛位移跳、AI 雷霆大跳
- 可编辑参数：最小窗口尺寸、顶部留空、最大跳跃高度、AI 跳跃冷却、窗口标题过滤
- 雷霆大跳落点：自动 / 指定窗口顶面 / 屏幕坐标（横向百分比 + 距顶部像素）/ 桌面底部
- 系统提示词模板：可加载、编辑、应用、恢复默认；支持 `{{maxJumpHeight}}` 和 `{{jumpCooldown}}` 变量，保存到当前部署的 `worlds/perch/ENV_PROMPT.md`
- 可站立窗口列表：每条是 `y=… · 宽度 · 窗口标题`
- 操作按钮：**应用** / **恢复默认** / **雷霆大跳** / **暂停·恢复** / **刷新**

| 按钮 | 背后做的事 |
|---|---|
| 让它跳一下 | World 置一个 `hop` 命令 → 宠物页面下次轮询地形时消费 → `body.do('jump')` |
| 暂停 | `platforms` 返回空 → Coo 落到地板并停在那儿；恢复后重新提供地形 |
| 刷新 | 重新拉一次面板状态 |

面板数据来自 World 的 `webUi().invoke`，走 Core 的 RPC：

```
POST /api/webui/providers/world:perch/panels/perch/{state,hop,pause,resume}
```

（`state` 在这个注册表里也要求 POST，不能 GET。`state` 返回 `{paused, pet, area, platforms}`。）

文件：`webui/client.js`（ESM，`export default { panels: { perch: { mount(ctx) } } }`）+ `webui/client.css`，
在 `package.json` 的 `cortico.webUiClient` / `webUiStyle` 里登记。

## 发布到扩展市场

市场里的扩展就是 npm 包。官方索引仓 `Pal-AI-Lab/cortico-extensions` 的 Action 定时扫 npm
（按 `keywords` 里的 `cortico-world` 发现），把 package.json 的 `cortico` 块、`CHANGELOG.md`、
`describe.json`、图标、下载量与讨论帖统计写进 `catalog.json`，控制台的扩展页读它。作者不需要提 PR。

发布前：

```bash
node scripts/make-describe.mjs     # 从 src/tools.js + ENV_PROMPT.md 生成 describe.json
node scripts/check-package.mjs     # 市场要求自检：元数据、标签词表、describe 一致性、CHANGELOG、图标
npm pack --dry-run                 # 看清包里有什么
```

然后：

```bash
npm login                          # 需要你自己的 npm 账号，这一步只能你来做
npm publish --access public
```

收录与后续：

- Action 定时同步；想立刻看到，在索引仓开一个标题为 `[sync]` 的 issue。
- 首次发布 14 天内卡片带「新品」徽标。
- 标签取自 `cortico.tags`：`apps`（观察其他应用窗口）、`external-setup`（`attach` 模式需要额外改动内置桌宠）、
  `experimental`（仍在测试）、`sensitive-data`（持续读取窗口标题与位置，并随工具回执发给模型）。
  `experimental` 与 `sensitive-data` 是提示/警示级，作者自己声明、后续可由维护者调整。
- 「官方」「认证」徽标作者不能自行声明。
- 版本更新只改 `version` 与 `CHANGELOG.md`，`npm publish` 后索引会跟着刷新。

## 卸载

`pnpm remove cortico-world-perch` + `worlds.perch.enabled=false`，然后把背包里改过的
`cortico-world-desktop-pet` 文件从 `.bak` 复制回去覆盖，Coo 就恢复成只在地板上走。
