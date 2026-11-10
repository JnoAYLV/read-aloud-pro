// Small Windows helpers through user32.dll (no admin, no install): which window is in front,
// its title, and sending Ctrl+C so we can copy whatever is highlighted in any program.
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');

const INPUT_KEYBOARD = 1, KEYEVENTF_KEYUP = 0x0002;
const VK = { CONTROL: 0x11, MENU: 0x12, SHIFT: 0x10, LWIN: 0x5B, RWIN: 0x5C, C: 0x43 };

const KEYBDINPUT = koffi.struct('KEYBDINPUT', { wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
const MOUSEINPUT = koffi.struct('MOUSEINPUT', { dx: 'long', dy: 'long', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
const INPUT = koffi.struct('INPUT', { type: 'uint32', u: koffi.union({ mi: MOUSEINPUT, ki: KEYBDINPUT }) });

const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)');
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(void* hWnd)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void* hWnd, _Out_ uint16_t* lpString, int nMaxCount)');
const GetClipboardSequenceNumber = user32.func('uint32 __stdcall GetClipboardSequenceNumber()');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void* hWnd, _Out_ uint32_t* lpdwProcessId)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(void* hWnd, _Out_ uint16_t* lpClassName, int nMaxCount)');
const RECT = koffi.struct('RAP_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void* hWnd, _Out_ RAP_RECT* r)');
const className = h => { const b = new Uint16Array(256); const n = GetClassNameW(h, b, 256); return Buffer.from(b.buffer).toString('utf16le', 0, n * 2); };
const windowRect = h => { const r = {}; return GetWindowRect(h, r) ? { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top } : null; };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (vk, up) => ({ type: INPUT_KEYBOARD, u: { ki: { wVk: vk, wScan: 0, dwFlags: up ? KEYEVENTF_KEYUP : 0, time: 0, dwExtraInfo: 0 } } });
function send(list) { SendInput(list.length, list, koffi.sizeof(INPUT)); }
const isDown = vk => (GetAsyncKeyState(vk) & 0x8000) !== 0;

// Wait (up to ~1.5 s) until the person lets go of the hotkey's Ctrl/Alt/Shift/Win, so our Ctrl+C is clean.
async function waitForModifiersUp() {
  for (let i = 0; i < 30; i++) {
    if (![VK.CONTROL, VK.MENU, VK.SHIFT, VK.LWIN, VK.RWIN].some(isDown)) return true;
    await sleep(50);
  }
  return false;
}
function foreground() {
  const h = GetForegroundWindow(); if (!h) return { hwnd: null, title: '', pid: 0 };
  const buf = new Uint16Array(512); const n = GetWindowTextW(h, buf, 512);
  const pid = new Uint32Array(1); GetWindowThreadProcessId(h, pid);
  return { hwnd: h, title: Buffer.from(buf.buffer).toString('utf16le', 0, n * 2), pid: pid[0] };
}
async function sendCopy() {
  const up = await waitForModifiersUp();
  // Still held: release Alt/Shift/Win for the target program, so it sees a plain Ctrl+C (not Ctrl+Alt+C).
  if (!up) send([key(VK.MENU, true), key(VK.SHIFT, true), key(VK.LWIN, true), key(VK.RWIN, true)]);
  send([key(VK.CONTROL), key(VK.C), key(VK.C, true), key(VK.CONTROL, true)]);
  return up;
}
module.exports = { className, windowRect, foreground, sendCopy, clipboardSeq: () => GetClipboardSequenceNumber(), focus: h => h && SetForegroundWindow(h), sleep };
