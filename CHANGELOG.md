# Changelog

## 0.2.7

The compatibility patch keeps working after a Coopanion update.

- Coopanion 0.2.5 replaced the built-in pet's files, and three of the seven patch
  targets stopped matching. All three are fixed: `web/pet-app.js` now uses four anchored
  inserts instead of a diff (the diff parser dropped blank context lines), the
  `web/body-host.js` frame anchor is a single line again (anchors are matched line by
  line, so a two-line anchor can never hit), and the `host/electron-main.cjs` anchor
  follows the new line while keeping the newly added `watchWindows(false)` call.
- `patch/figure-frame.thunder.txt` was missing its closing brace, which would have
  produced a file that fails to parse.
- Applying twice is a no-op: the second run reports every file as already patched and
  leaves them byte-identical.

Note: the built-in pet ships inside Coopanion, so each Coopanion update replaces those
files. Press "apply compatibility patch" again after upgrading the app.

## 0.2.6

- Icon: minimal square crop of the original screenshot (centre 724×724, no content trimmed away),
  scaled to 512×512. Replaces the tighter close-up used in 0.2.5. No behaviour change.

## 0.2.5

- New icon: the pet's face instead of the drawn placeholder. No behaviour change.

## 0.2.4

- Added `repository`, `homepage` and `bugs`, so the market and npm can link back to the source.
- No behaviour change.

## 0.2.3

Roaming jumps actually leave the ground now.

- Fixed: automatic window hops and travelling jumps were rejected for ever once the page had set
  its "stay put" timer — the check compared the timer's timestamp against zero instead of the
  clock, so only the floor-hop fallback ever ran. That is why the pet kept hopping in place on the
  floor while window-ledges still worked (those came from edge leaps).
- Reaching a high window now works on tall or portrait screens: the jump arc may rise 1700 px
  (was 1000) and the launch speed may reach 2900 px/s.
- The last-resort floor hop aims across the screen instead of where the pet happens to face, so it
  never lands on its own feet at a screen edge.
- Panel state shows the reason for the last roaming jump (`diag.hopWhy`) and the terrain it saw.

## 0.2.2

Renamed to **雷霆大跳** (Thunder Jump) in the extension market and in the console panel. The package
name, the World id (`perch`) and everything else stay the same, so this is a normal update.

## 0.2.1

Same package as 0.2.0, republished: npm had locked 0.2.0 behind a staged placeholder
(`0.0.0-stage`) that never went live, so this version carries the first public release.

## 0.2.0

First public release on the extension market.

- **Window perching**: the tops of visible windows act as ground; the companion walks along them, and a window that is dragged carries the pet with it.
- **Multi-monitor**: the terrain follows the display the pet is on, including displays left of or above the primary one and screens with a different scale factor.
- **Thunder jump**: `perch_hop` leaps to another window top or the desktop floor. It always travels sideways now; a jump used to come out as a hop on the spot.
- **Chosen landing spot**: give `title` (part of a window title), or `x` (0–1 across the screen) with `y` (pixels from the top), or `mode: floor`.
- **Roaming jumps travel — and change window**: an idle jump prefers another window top (up or down) over the floor, lands at least 150px away from where it stood, and retries the arc instead of giving up. The panel shows where the last one aimed.
- **Console panel**: every feature as a switch (window perching, edge leaps, automatic hops, roaming jumps, AI thunder jump), editable numbers (window-size filters, headroom, max jump height, AI cooldown), a window-title filter, a jump-destination picker, and the last landing shown for checking.
- **Editable system prompt**: the environment prompt is a template with `{{maxJumpHeight}}` and `{{jumpCooldown}}`, editable in the panel and saved as a deployment override.
- **One-click compatibility patch**: the panel can add the terrain hook to Coopanion's built-in desktop pet itself — 7 files, each backed up as `.perch-orig`, restorable, and skipped when the installed version does not match.

## 0.1.0

Internal build: window enumeration on Win32, terrain service, and the first perch prototype.
