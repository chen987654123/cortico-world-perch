/**
 * Top-level window geometry through Win32 (koffi), for the perch World.
 *
 * Coordinates are physical pixels of the virtual screen, as Windows reports them to a
 * DPI-aware process. The page converts them to CSS pixels with its devicePixelRatio.
 */
import koffi from 'koffi';

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');

koffi.alias('HANDLE', 'void *');
koffi.alias('HWND', 'HANDLE');

const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const MONITORINFO = koffi.struct('MONITORINFO', { cbSize: 'uint32_t', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32_t' });
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)');
const MonitorEnumProc = koffi.proto('bool __stdcall MonitorEnumProc(void *monitor, void *hdc, RECT *rect, intptr_t lParam)');

const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
const EnumDisplayMonitors = user32.func('bool __stdcall EnumDisplayMonitors(void *hdc, RECT *clip, MonitorEnumProc *cb, intptr_t lParam)');
const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(void *monitor, _Inout_ MONITORINFO *info)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(HWND hwnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(HWND hwnd)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(HWND hwnd, _Out_ uint16_t *buf, int max)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(HWND hwnd, _Out_ RECT *rect)');
const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(HWND hwnd, int index)');
const SystemParametersInfoW = user32.func('bool __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, _Inout_ RECT *rect, uint32_t winIni)');
const DwmGetWindowAttributeInt = dwmapi.func('long __stdcall DwmGetWindowAttribute(HWND hwnd, uint32_t attr, _Out_ int *value, uint32_t size)');
const DwmGetWindowAttributeRect = dwmapi.func('long __stdcall DwmGetWindowAttribute(HWND hwnd, uint32_t attr, _Out_ RECT *value, uint32_t size)');

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const MONITOR_DEFAULTTONEAREST = 2;
const SPI_GETWORKAREA = 0x0030;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;

/** Per-monitor DPI aware (v2): nothing below is scaled for us. */
try { user32.func('bool __stdcall SetProcessDpiAwarenessContext(intptr_t value)')(-4); } catch { /* older Windows */ }

/** The primary display's work area (the region not covered by the taskbar), physical pixels. */
export function workArea() {
  const r = { left: 0, top: 0, right: 0, bottom: 0 };
  SystemParametersInfoW(SPI_GETWORKAREA, 0, r, 0);
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/** All connected displays and their work areas, in the same physical virtual-screen coordinates. */
export function displayWorkAreas() {
  const out = [];
  EnumDisplayMonitors(null, null, (monitor) => {
    const info = { cbSize: koffi.sizeof(MONITORINFO), rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 }, rcWork: { left: 0, top: 0, right: 0, bottom: 0 }, dwFlags: 0 };
    if (!GetMonitorInfoW(monitor, info)) return true;
    const m = info.rcMonitor, w = info.rcWork;
    out.push({
      id: koffi.address(monitor).toString(16),
      x: m.left, y: m.top, width: m.right - m.left, height: m.bottom - m.top,
      work: { x: w.left, y: w.top, width: w.right - w.left, height: w.bottom - w.top },
      primary: (info.dwFlags & 1) !== 0,
    });
    return true;
  }, 0);
  return out.length ? out : [{ id: 'primary', ...workArea(), work: workArea(), primary: true }];
}

/** Find the display containing a point, falling back to the nearest display. */
export function displayAt(x, y) {
  const all = displayWorkAreas();
  const inside = all.find((d) => x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height);
  if (inside) return inside;
  return all.reduce((best, d) => {
    const dx = x < d.x ? d.x - x : x > d.x + d.width ? x - (d.x + d.width) : 0;
    const dy = y < d.y ? d.y - y : y > d.y + d.height ? y - (d.y + d.height) : 0;
    const dist = dx * dx + dy * dy;
    return !best || dist < best.dist ? { ...d, dist } : best;
  }, null);
}

/** The visible frame of a window, without the invisible resize border Windows adds around it. */
function frameRect(hwnd) {
  const r = { left: 0, top: 0, right: 0, bottom: 0 };
  if (DwmGetWindowAttributeRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, koffi.sizeof(RECT)) !== 0) GetWindowRect(hwnd, r);
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/**
 * Visible, titled, uncloaked, non-minimized top-level windows, in z-order (topmost first).
 * The companion's own overlay is a tool window, so it never shows up here.
 */
export function windows() {
  const out = [];
  const buf = new Uint16Array(512);
  EnumWindows((hwnd) => {
    if (!IsWindowVisible(hwnd)) return true;
    if (IsIconic(hwnd)) return true;
    if (Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) return true;
    const cloaked = [0];
    if (DwmGetWindowAttributeInt(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) return true;
    const n = GetWindowTextW(hwnd, buf, buf.length);
    if (n <= 0) return true;
    const title = String.fromCharCode(...buf.subarray(0, n));
    const rect = frameRect(hwnd);
    if (rect.width < 40 || rect.height < 40) return true;
    out.push({ handle: koffi.address(hwnd).toString(16), title, ...rect });
    return true;
  }, 0);
  return out;
}
