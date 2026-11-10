// Read Aloud Pro (desktop): reads text from ANY program (Outlook, Word, PDFs, web) with a hotkey,
// reads the screen with Windows text recognition, and runs the reader / finder / memory / Claude window.
const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, Tray, Menu, nativeImage, shell, dialog, desktopCapturer, utilityProcess, session, Notification, screen, ClipboardItem } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const store = require('./store');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
let reader = null, settingsWin = null, tray = null, worker = null, core = null, win = null;
const RENDERER = path.join(__dirname, '..', 'renderer');
const ICON = path.join(RENDERER, 'icons', 'icon128.png');

// ------------------------------------------------------------------ AI worker (Kokoro voice, Whisper speech recognition)
const pending = new Map(); let nextId = 1;
function startWorker() {
  const cache = path.join(app.getPath('userData'), 'models');
  worker = utilityProcess.fork(path.join(__dirname, 'ai-worker.js'), [], { env: { ...process.env, RAP_MODEL_CACHE: cache }, serviceName: 'Read Aloud Pro voice' });
  worker.on('message', m => { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m); } });
  worker.on('exit', () => { for (const p of pending.values()) p.reject(new Error('Voice engine stopped; it will restart.')); pending.clear(); worker = null; });
}
function ai(op, payload = {}) {
  if (!worker) startWorker();
  return new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); worker.postMessage({ id, op, ...payload }); });
}

// ------------------------------------------------------------------ windows
function createReader(show = true) {
  if (reader && !reader.isDestroyed()) { if (show) { reader.show(); reader.focus(); } return reader; }
  reader = new BrowserWindow({
    width: 1180, height: 820, minWidth: 760, minHeight: 500, show, icon: ICON, title: 'Read Aloud Pro', backgroundColor: '#f6f7f9',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false }
  });
  reader.setMenuBarVisibility(false);
  reader.loadFile(path.join(RENDERER, 'index.html'));
  reader.on('close', e => { if (!app.isQuitting) { e.preventDefault(); reader.hide(); } });
  return reader;
}
function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({ width: 900, height: 860, icon: ICON, title: 'Read Aloud Pro – Settings', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false } });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(RENDERER, 'settings.html'), { hash: section || '' });
}
const toReaderQuiet = (channel, payload) => { const w = createReader(false); const go = () => w.webContents.send(channel, payload); w.webContents.isLoading() ? w.webContents.once('did-finish-load', go) : go(); };
const toReader = (channel, payload) => { const w = createReader(true); const go = () => w.webContents.send(channel, payload); w.webContents.isLoading() ? w.webContents.once('did-finish-load', go) : go(); };
function tell(body) { notify(body); toReader('status', body); }
function notify(body) { try { new Notification({ title: 'Read Aloud Pro', body, icon: ICON, silent: true }).show(); } catch {} }

// ------------------------------------------------------------------ grabbing text from any program
// One line per grab in userData\grab-log.txt: which window, whether the copy worked, how many characters.
// Never the text itself.
function grabLog(o) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'grab-log.txt'), new Date().toISOString() + ' ' + JSON.stringify(o) + '\n'); } catch {}
}
let lastOther = null;
setInterval(() => { try { const f = win.foreground(); if (f.hwnd && f.pid && f.pid !== process.pid && f.title) lastOther = f; } catch {} }, 400);
async function grabSelection() {
  let fg = win.foreground();
  if (fg.pid === process.pid) {
    // Our own window is in front. If text is highlighted in it, read that; otherwise go back to the
    // program the person was in just before, and copy from there.
    const sel = reader && !reader.isDestroyed() && reader.isFocused()
      ? await reader.webContents.executeJavaScript('String(getSelection())').catch(() => '') : '';
    if (sel.trim() || !lastOther) { grabLog({ step: 'in-app', title: fg.title, hasSel: !!sel.trim(), lastOther: !!lastOther }); return { inApp: true, title: fg.title }; }
    win.focus(lastOther.hwnd); await win.sleep(250);
    fg = win.foreground();
    grabLog({ step: 'back-to-previous', title: fg.title, ok: fg.pid !== process.pid });
    if (fg.pid === process.pid) return { text: '', title: lastOther.title };
  }
  grabLog({ step: 'saving-clipboard' });
  // Electron 45's clipboard is asynchronous. Take a full copy of what is on it now, so it can be put back after.
  const saved = [];
  try {
    for (const it of await clipboard.read()) {
      const o = {}; for (const ty of it.types) { try { o[ty] = await it.getType(ty); } catch {} }
      if (Object.keys(o).length) saved.push(o);
    }
  } catch (e) { grabLog({ step: 'save-failed', msg: e.message }); }
  grabLog({ step: 'sending-copy' });
  const seq0 = win.clipboardSeq();
  const keysUp = await win.sendCopy();
  let changed = false;
  for (let i = 0; i < 25 && !changed; i++) { await win.sleep(40); changed = win.clipboardSeq() !== seq0; }
  if (!changed) {                                  // some programs (Outlook, Word) are slow: try once more
    await win.sendCopy();
    for (let i = 0; i < 25 && !changed; i++) { await win.sleep(40); changed = win.clipboardSeq() !== seq0; }
  }
  grabLog({ step: 'copy', title: fg.title, pid: fg.pid, keysUp, changed });
  if (!changed) return { text: '', title: fg.title };
  await win.sleep(80);
  const text = await clipboard.readText();
  try { saved.length ? await clipboard.write(saved.map(o => new ClipboardItem(o))) : clipboard.clear(); }
  catch (e) { grabLog({ step: 'restore-failed', msg: e.message }); }
  grabLog({ step: 'done', chars: text.length });
  return { text, title: fg.title, hwnd: fg.hwnd };
}
const cleanTitle = t => String(t || '').replace(/\s+-\s+(Outlook|Word|Excel|PowerPoint|Adobe Acrobat.*|Google Chrome|Microsoft​? Edge|Notepad)\s*$/i, '').trim() || 'Untitled';

async function readFromApp() {
  let g; try { g = await grabSelection(); } catch (e) { grabLog({ step: 'error', msg: String(e && e.stack || e).slice(0, 600) }); tell('Could not copy the highlighted text: ' + (e && e.message)); return; }
  if (g.inApp) return toReader('command', { type: 'read-selection' });
  grabLog({ step: 'read', chars: g.text.length });
  if (!g.text.trim()) { tell('Nothing highlighted came through. Highlight some text, keep that window in front, then press Ctrl+Alt+R. Or press Ctrl+Alt+O to read the screen.'); return; }
  // Highlight in the original program when it shares word positions (Outlook, Word, browsers, Notepad...).
  // Then the reader stays where it is, so the program you are reading stays in front.
  const linked = (store.get('settings') || {}).sourceHighlight !== false && g.hwnd ? await src.attach(g.hwnd) : false;
  grabLog({ step: 'source-highlight', linked });
  (linked ? toReaderQuiet : toReader)('load-text', { title: cleanTitle(g.title), text: g.text, from: g.title, autoRead: true, linked });
}
async function memoryFromApp() {
  let g; try { g = await grabSelection(); } catch (e) { grabLog({ step: 'error', msg: String(e && e.stack || e).slice(0, 600) }); tell('Could not copy the highlighted text: ' + (e && e.message)); return; }
  if (g.inApp) return toReader('command', { type: 'collect-selection' });
  if (!g.text.trim()) { notify('Nothing highlighted to add to memory.'); return; }
  const item = { id: 'c' + Math.random().toString(36).slice(2, 9), title: cleanTitle(g.title).slice(0, 120), url: '', kind: 'highlighted', text: g.text.slice(0, 200000), added: Date.now() };
  store.set({ collection: [...(store.get('collection') || []), item] });
  if (g.text.length > 200000) tell(`Added to memory, but CUT SHORT: only the first 200,000 of ${g.text.length.toLocaleString()} characters were kept. Add the rest as a second item.`);
  else notify(`Added to memory: ${item.title}`);
}
// For the picker: every screen and every open window (not our own), with small previews.
const isOwnWindow = n => /(^|\s)Read Aloud Pro( – Settings)?$/.test(n);
async function listScreens() {
  const displays = screen.getAllDisplays();
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 360, height: 220 } });
  return sources.filter(s => s.name && !isOwnWindow(s.name) && !/Overlay|^Program Manager$/i.test(s.name) && !s.thumbnail.isEmpty()).sort((a, b) => (b.id.startsWith('screen:') - a.id.startsWith('screen:')) || (a.name === 'Main screen' ? -1 : 0)).map(s => {
    let name = s.name;
    if (s.id.startsWith('screen:')) {
      // Name screens by where they sit, not by number (Windows' numbers rarely match what people see).
      const d = displays.find(x => String(x.id) === String(s.display_id)); const main = screen.getPrimaryDisplay();
      const where = !d ? 'Screen' : d.id === main.id ? 'Main screen'
        : d.bounds.x + d.bounds.width <= main.bounds.x ? 'Left screen' : d.bounds.x >= main.bounds.x + main.bounds.width ? 'Right screen'
        : d.bounds.y < main.bounds.y ? 'Upper screen' : 'Lower screen';
      name = d ? `${where} (${d.size.height > d.size.width ? 'portrait' : 'landscape'})` : s.name;
    }
    return { id: s.id, kind: s.id.startsWith('screen:') ? 'screen' : 'window', name, thumb: s.thumbnail.toDataURL() };
  });
}
async function readScreen(sourceId, label) {
  const fg = win.foreground();
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 4000, height: 4000 } });
  const own = fg.pid === process.pid;
  const src = (sourceId && sources.find(s => s.id === sourceId))
    || (!sourceId && !own && sources.find(s => s.id.startsWith('window:') && s.name === fg.title))
    || sources.find(s => s.id.startsWith('screen:'));
  if (sourceId && src && src.id !== sourceId) { tell('That screen or window is no longer available. Try Read screen again.'); return; }
  if (!src) { notify('Could not capture the screen.'); return; }
  const png = path.join(os.tmpdir(), `rap-screen-${Date.now()}.png`);
  // Windows text recognition misreads small screen text; doubling the picture first makes it far more accurate.
  let img = src.thumbnail; const { width: w0, height: h0 } = img.getSize();
  const up = Math.min(2, 9000 / Math.max(w0, h0, 1));
  if (up > 1.05) img = img.resize({ width: Math.round(w0 * up), height: Math.round(h0 * up), quality: 'best' });
  fs.writeFileSync(png, img.toPNG());
  // In a browser window, skip the tabs, address bar and bookmarks (the top ~120 screen pixels).
  const isBrowser = /(Google Chrome|Microsoft.? Edge|Firefox|Brave|Opera)\s*$/i.test(src.name) && src.id.startsWith('window:');
  const dpi = screen.getPrimaryDisplay().scaleFactor || 1;
  try {
    const text = await core.ocrImage(png, { skipTop: isBrowser ? Math.round(120 * dpi * Math.max(up, 1)) : 0 });
    if (!text.trim()) { notify('No text found on screen.'); return; }
    toReader('load-text', { title: (label || cleanTitle(src.name)) + ' (screen)', text, from: label || src.name, autoRead: true });
  } catch (e) { notify('Text recognition failed: ' + e.message); }
  finally { fs.rmSync(png, { force: true }); }
}

// ------------------------------------------------------------------ highlighting inside the original program
// Two ways to know where each word is on screen:
//  - "program": Windows UI Automation (uia.ps1) asks the program itself. Exact and instant in Outlook,
//    Word, Notepad and other desktop programs.
//  - "screen": read the screen (ocrsvc.ps1, Windows text recognition) and line the screen words up with
//    the sentence being read. Used for Chrome, Edge, Firefox and other browser-based programs (their own
//    positions are wrong inside scrolling boxes such as web email), and for any program that does not
//    report positions at all (PDF readers, images).
// A transparent, click-through window draws a soft band on the sentence, a box on the word and the name /
// word-group colours. It shows only while that program is in front, is excluded from screen pictures, and
// never touches the document (in "program" mode it may scroll it into view).
const src = (() => {
  function helper(file) {
    let ps = null, buf = '', waiters = [];
    const start = () => {
      if (ps) return;
      ps = require('child_process').spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(core.SCRIPTS, file)], { windowsHide: true });
      buf = ''; waiters = [() => {}];                          // the helper's "ready" line
      ps.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) { const w = waiters.shift(); try { w && w(JSON.parse(l)); } catch { w && w({ ok: false }); } } } });
      ps.on('exit', () => { ps = null; for (const w of waiters) w({ ok: false, why: 'helper stopped' }); waiters = []; });
    };
    const ask = (o, ms = 4000) => new Promise(res => {
      start(); let done = false; const t = setTimeout(() => { if (!done) { done = true; res({ ok: false, why: 'timeout' }); } }, ms);
      waiters.push(r => { if (!done) { done = true; clearTimeout(t); res(r); } });
      ps.stdin.write(JSON.stringify(o) + '\n');
    });
    return { ask, running: () => !!ps };
  }
  const uia = helper('uia.ps1'), ocr = helper('ocrsvc.ps1');
  let mode = null, hwnd = null, hwndRaw = null, overlay = null, timer = null, active = false, busy = false;
  let sentBoxes = [], wordBoxes = [], termBoxes = [], hasTerms = false;
  let ticks = 0, lastSig = '', moving = false, still = 0, movingSince = 0;       // movement watching
  let region = null, words = [], curTokens = null, curMap = null, curK = -1, termItems = [], lastY = null; // screen mode
  const diag = { n: 0 };
  const addr = h => { try { return String(require('koffi').address(h)); } catch { return null; } };
  const front = () => hwnd && addr(win.foreground().hwnd) === hwnd;
  const hideNow = () => { if (overlay && !overlay.isDestroyed() && overlay.isVisible()) overlay.hide(); };

  function ensureOverlay() {
    if (overlay && !overlay.isDestroyed()) return overlay;
    overlay = new BrowserWindow({ show: false, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true,
      hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000', webPreferences: { contextIsolation: true, sandbox: true } });
    overlay.setAlwaysOnTop(true, 'screen-saver'); overlay.setIgnoreMouseEvents(true);
    overlay.setContentProtection(true);         // invisible to screen pictures, so screen reading never sees our own highlight
    overlay.loadFile(path.join(RENDERER, 'overlay.html'));
    return overlay;
  }
  function draw() {
    const all = [...sentBoxes, ...wordBoxes, ...termBoxes.flatMap(t => t.boxes)];
    if (!active || !all.length || !front() || moving) { hideNow(); return; }
    const dip = b => screen.screenToDipRect(null, { x: b[0], y: b[1], width: b[2], height: b[3] });
    const S = sentBoxes.map(dip), W = wordBoxes.map(dip), T = termBoxes.map(t => ({ c: t.c, r: t.boxes.map(dip) })), A = [...S, ...W, ...T.flatMap(t => t.r)];
    const x = Math.min(...A.map(r => r.x)) - 4, y = Math.min(...A.map(r => r.y)) - 4;
    const bounds = { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(Math.max(...A.map(r => r.x + r.width)) - x + 4), height: Math.ceil(Math.max(...A.map(r => r.y + r.height)) - y + 4) };
    const rel = r => ({ x: r.x - bounds.x, y: r.y - bounds.y, w: r.width, h: r.height });
    const o = ensureOverlay();
    const send = () => o.webContents.executeJavaScript(`window.rapDraw(${JSON.stringify({ s: S.map(rel), w: W.map(rel), t: T.map(t => ({ c: t.c, r: t.r.map(rel) })) })})`).catch(() => {});
    o.setBounds(bounds);
    if (diag.n < 400 && process.argv.includes('--rap-test')) {   // test mode only: userData\highlight-diag.txt, positions only, never text
      diag.n++; const got = o.getBounds();
      try { fs.appendFileSync(path.join(app.getPath('userData'), 'highlight-diag.txt'), JSON.stringify({ t: new Date().toISOString().slice(11, 23), mode, asked: [bounds.x, bounds.y, bounds.width, bounds.height], got: [got.x, got.y, got.width, got.height], sent: sentBoxes.slice(0, 3), word: wordBoxes, terms: termBoxes.length }) + '\n'); } catch {}
    }
    o.webContents.isLoading() ? o.webContents.once('did-finish-load', send) : send();
    if (!o.isVisible()) o.showInactive();
  }

  // ---- screen mode: line the spoken words up with the words read from the screen
  const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  function lev(a, b) {
    const d = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
    return d[b.length];
  }
  // Screen text recognition makes small mistakes ("brlefings"): allow 1 wrong letter in 4+ letter words, 2 in 8+.
  const same = (a, b) => !!a && !!b && (a === b || (Math.max(a.length, b.length) >= 4 && lev(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1)));
  function align(tokens) {
    const O = words.map(w => norm(w.t)), S = tokens.map((t, j) => ({ t, j })).filter(x => x.t);
    if (!S.length || !O.length) return null;
    let best = null;
    for (let i = 0; i < O.length; i++) for (let off = 0; off < Math.min(3, S.length); off++) {
      if (!same(O[i], S[off].t)) continue;
      const map = { [S[off].j]: i }; let p = i + 1, score = 1;
      for (let q = off + 1; q < S.length; q++) for (let k = p; k < Math.min(O.length, p + 3); k++) if (same(O[k], S[q].t)) { map[S[q].j] = k; p = k + 1; score++; break; }
      // Repeated wording: prefer the copy at or just below the previous sentence.
      const y = words[i].b[1], away = lastY == null ? 0 : (y < lastY - 8 ? 1e6 + lastY - y : y - lastY);
      if (!best || score > best.score || (score === best.score && away < best.away)) best = { map, score, away };
    }
    const need = S.length <= 2 ? S.length : Math.max(2, Math.ceil(S.length * 0.5));
    return best && best.score >= need ? best.map : null;
  }
  function band(map) {                         // one box per screen line the sentence covers
    const lines = {};
    for (const idx of Object.values(map)) { const w = words[idx]; (lines[w.l] = lines[w.l] || []).push(w.b); }
    return Object.values(lines).map(bs => { const x1 = Math.min(...bs.map(b => b[0])), y1 = Math.min(...bs.map(b => b[1])), x2 = Math.max(...bs.map(b => b[0] + b[2])), y2 = Math.max(...bs.map(b => b[1] + b[3])); return [x1 - 2, y1 - 2, x2 - x1 + 4, y2 - y1 + 4]; });
  }
  function screenTerms() {
    const O = words.map(w => norm(w.t)), out = [];
    for (const it of termItems) {
      const toks = String(it.t).split(/\s+/).map(norm).filter(Boolean); if (!toks.length) continue;
      const boxes = [];
      for (let i = 0; i + toks.length <= O.length; i++) {
        if (!toks.every((t, k) => same(O[i + k], t))) continue;
        const bs = toks.map((_, k) => words[i + k].b), x1 = Math.min(...bs.map(b => b[0])), y1 = Math.min(...bs.map(b => b[1]));
        boxes.push([x1 - 1, y1 - 1, Math.max(...bs.map(b => b[0] + b[2])) - x1 + 2, Math.max(...bs.map(b => b[1] + b[3])) - y1 + 2]);
      }
      if (boxes.length) out.push({ c: it.c, boxes });
    }
    return out;
  }
  function screenPlace() {                     // recompute every box from the latest screen words
    curMap = curTokens ? align(curTokens) : null;
    sentBoxes = curMap ? band(curMap) : [];
    wordBoxes = curMap && curMap[curK] != null ? [words[curMap[curK]].b] : [];
    termBoxes = screenTerms();
    if (sentBoxes.length) lastY = sentBoxes[0][1];
  }
  async function readScreenNow() {
    const wr = win.windowRect(hwndRaw); if (!wr) return false;
    if (!region || region.win !== JSON.stringify(wr)) {         // the window moved or resized: find its document area again
      const dr = await uia.ask({ op: 'docrect', hwnd }, 3000);
      region = dr.ok && dr.w > 50 && dr.h > 50 ? { x: dr.x, y: dr.y, w: dr.w, h: dr.h } : { x: wr.x + 8, y: wr.y + 8, w: wr.w - 16, h: wr.h - 16 };   // no document area found: use the whole window
      region.win = JSON.stringify(wr);
    }
    const r = await ocr.ask({ op: 'ocr', hwnd, x: region.x, y: region.y, w: region.w, h: region.h }, 8000);
    if (!r.ok) { grabLog({ step: 'src-screen-read', ok: false, why: r.why }); return false; }
    words = r.words || []; screenPlace(); return true;
  }

  // ---- watching for movement (scrolling, zooming, window moved) in either mode
  function watch() {
    clearInterval(timer);
    timer = setInterval(async () => {
      if (busy || !active) return;
      if (!front()) { hideNow(); return; }
      busy = true;
      try {
        ticks++;
        let sig;
        if (mode === 'program') { const p = await uia.ask({ op: 'probe' }, 1500); sig = p.ok ? p.sig : lastSig; }
        else { const wr = win.windowRect(hwndRaw); const h = region ? await ocr.ask({ op: 'hash', hwnd, x: region.x, y: region.y, w: region.w, h: region.h }, 1500) : { ok: false }; sig = (h.ok ? h.h : lastSig) + JSON.stringify(wr); }
        if (sig !== lastSig) {
          lastSig = sig; still = 0;
          if (!moving) { moving = true; movingSince = Date.now(); hideNow(); }
          if (Date.now() - movingSince < 3000) return;    // keeps changing (e.g. a video on the page): place it anyway every few seconds
        } else if (moving && ++still < 2) return;
        if (!moving && ticks % (mode === 'program' ? 10 : 15)) return;
        moving = false; movingSince = 0;
        if (mode === 'program') { const r = await uia.ask({ op: 'refresh' }, 3000); if (r.ok) { sentBoxes = r.sent || []; wordBoxes = r.word || []; termBoxes = r.terms || []; } }
        else await readScreenNow();
        draw();
      } finally { busy = false; }
    }, mode === 'program' ? 150 : 300);
  }

  return {
    async attach(h) {
      const a = addr(h); if (!a) return false;
      clearInterval(timer); hideNow();
      mode = null; hwnd = a; hwndRaw = h; active = false; sentBoxes = []; wordBoxes = []; termBoxes = []; hasTerms = false;
      lastSig = ''; moving = false; region = null; words = []; curTokens = null; curMap = null; curK = -1; termItems = []; lastY = null;
      const cls = win.className(h);
      const browser = /^(Chrome_WidgetWin_\d|MozillaWindowClass)$/.test(cls);    // Chrome, Edge, Firefox and apps built on them
      // Text drawn by the Chrome engine (new Outlook, Teams, Slack and other web-based programs) reports wrong
      // positions inside scrolling boxes, just like the browsers, so those use screen reading too.
      let fw = '';
      if (!browser) { const r = await uia.ask({ op: 'attach', hwnd: a, cls }, 6000); fw = r.framework || ''; if (r.ok && !/^chrome$/i.test(fw)) mode = 'program'; else if (!r.ok) grabLog({ step: 'program-attach-failed', why: r.why }); }
      if (!mode) { mode = 'screen'; if (!(await readScreenNow()) || !words.length) mode = null; }
      grabLog({ step: 'source-highlight-mode', mode: mode || 'none', browser, framework: fw, cls });
      active = !!mode; if (active) watch();
      return active;
    },
    async sentence(m) {
      if (!active) return;
      if (mode === 'program') {
        const r = await uia.ask({ op: 'sentence', i: m.i, first: m.first, last: m.last, len: m.len, scroll: (store.get('settings') || {}).followScroll !== false });
        grabLog({ step: 'src-sentence', mode, ok: r.ok, why: r.why, boxes: (r.boxes || []).length, ...(process.argv.includes('--rap-test') ? { at: r.boxes } : {}) });
        sentBoxes = r.ok ? r.boxes || [] : []; wordBoxes = [];
      } else {
        curTokens = (m.words || []).map(norm); curK = -1;
        screenPlace();
        if (!curMap && !moving) { await readScreenNow(); }           // not on the last picture (scrolled?): read the screen again
        grabLog({ step: 'src-sentence', mode, ok: !!curMap, boxes: sentBoxes.length, ...(process.argv.includes('--rap-test') ? { at: sentBoxes, screenWords: words.length } : {}) });
      }
      draw();
    },
    async word(m) {
      if (!active) return;
      if (mode === 'program') {
        const r = await uia.ask({ op: 'word', text: m.text });
        if (!r.ok) grabLog({ step: 'src-word', ok: false, why: r.why });
        if (r.ok) { wordBoxes = r.boxes || []; if (r.sent) sentBoxes = r.sent; }
        if (process.argv.includes('--rap-test')) grabLog({ step: 'src-word', mode, text: m.text, at: wordBoxes });
      } else {
        curK = m.k; wordBoxes = curMap && curMap[curK] != null ? [words[curMap[curK]].b] : [];
        if (process.argv.includes('--rap-test')) grabLog({ step: 'src-word', mode, k: curK, at: wordBoxes });
      }
      draw();
    },
    async terms(m) {
      if (!active) return;
      if (mode === 'program') {
        const r = await uia.ask({ op: 'terms', items: m.items }, 8000);
        hasTerms = !!(r.ok && r.count); termBoxes = r.ok ? r.terms || [] : [];
        grabLog({ step: 'src-terms', ok: r.ok, found: r.count || 0 });
      } else { termItems = m.items || []; termBoxes = screenTerms(); grabLog({ step: 'src-terms', mode, found: termBoxes.reduce((n, t) => n + t.boxes.length, 0) }); }
      draw();
    },
    clear(stopAll) {
      sentBoxes = []; wordBoxes = []; curTokens = null; curMap = null; curK = -1;
      if (stopAll) { active = false; mode = null; hwnd = null; termBoxes = []; termItems = []; words = []; clearInterval(timer); if (uia.running()) uia.ask({ op: 'detach' }); }
      draw();
    }
  };
})();
// ------------------------------------------------------------------ automatic updates (GitHub releases of JnoAYLV/read-aloud-pro)
// Checks 30 seconds after start and every 4 hours, downloads quietly, then asks before restarting.
// If the person says Later, the update installs the next time the app is quit. Can be switched off in Settings.
let updater = null, updateStatus = 'Not checked yet.';
const updLog = msg => { updateStatus = msg; try { fs.appendFileSync(path.join(app.getPath('userData'), 'update-log.txt'), new Date().toISOString() + ' ' + msg + '\n'); } catch {} };
function setupUpdates() {
  if (!app.isPackaged) { updateStatus = 'Updates only run in the installed app.'; return; }
  try { updater = require('electron-updater').autoUpdater; } catch (e) { updLog('Updater unavailable: ' + e.message); return; }
  updater.autoDownload = true; updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => updLog('Checking for updates…'));
  updater.on('update-not-available', () => updLog(`Up to date (version ${app.getVersion()}).`));
  updater.on('update-available', i => updLog(`Downloading version ${i.version}…`));
  updater.on('error', e => updLog('Update check failed: ' + String(e?.message || e).split('\n')[0]));
  updater.on('update-downloaded', async i => {
    updLog(`Version ${i.version} is ready to install.`);
    const r = await dialog.showMessageBox({ type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1, title: 'Read Aloud Pro update',
      message: `Read Aloud Pro ${i.version} is ready.`, detail: 'Restart now to use it. If you choose Later, it installs the next time Read Aloud Pro is closed from the tray.' });
    if (r.response === 0) { app.isQuitting = true; updater.quitAndInstall(true, true); }
  });
  const check = () => { if ((store.get('settings') || {}).autoUpdate === false) return; updater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 30000); setInterval(check, 4 * 3600 * 1000);
}
// ------------------------------------------------------------------ shortcut keys (the person can change each one)
const HOTKEYS = {
  read:   { label: 'Read highlighted text',            def: 'Control+Alt+R',     run: () => readFromApp() },
  memory: { label: 'Add highlighted text to memory',   def: 'Control+Alt+M',     run: () => memoryFromApp() },
  screen: { label: 'Read the window in front',         def: 'Control+Alt+O',     run: () => readScreen() },
  voice:  { label: 'Push-to-talk (voice command)',     def: 'Control+Alt+V',     run: () => toReader('command', { type: 'voice' }) },
  pause:  { label: 'Pause / resume',                   def: 'Control+Alt+Space', run: () => toReader('command', { type: 'pause-resume' }) },
  stop:   { label: 'Stop reading',                     def: 'Control+Alt+S',     run: () => toReader('command', { type: 'stop' }) }
};
let hotkeysSuspended = false;
const currentHotkeys = () => { const saved = (store.get('settings') || {}).hotkeys || {}; return Object.fromEntries(Object.keys(HOTKEYS).map(id => [id, saved[id] ?? HOTKEYS[id].def])); };
const prettyKey = a => String(a || '').replace(/Control/g, 'Ctrl').replace(/Super/g, 'Win').replace(/CommandOrControl/g, 'Ctrl');
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [id, acc] of Object.entries(currentHotkeys())) {
    if (!acc) continue;
    let ok = false; try { ok = globalShortcut.register(acc, HOTKEYS[id].run); } catch {}
    if (!ok) failed.push(`${prettyKey(acc)} (${HOTKEYS[id].label})`);
  }
  return failed;
}
// Shortcuts other programs (or Windows itself) already use. Taking one of these means that program
// no longer gets it while Read Aloud Pro is running, so the person is warned before saving.
const KNOWN_KEYS = {
  'Control+C': 'Copy, in every program', 'Control+V': 'Paste, in every program', 'Control+X': 'Cut, in every program', 'Control+Z': 'Undo, in every program',
  'Control+Y': 'Redo', 'Control+A': 'Select all', 'Control+S': 'Save', 'Control+P': 'Print', 'Control+F': 'Find', 'Control+N': 'New item or window',
  'Control+O': 'Open a file', 'Control+W': 'Close a tab or window', 'Control+T': 'New browser tab', 'Control+R': 'Reply in Outlook, reload in browsers',
  'Control+Shift+R': 'Reply all in Outlook', 'Control+Enter': 'Send in Outlook', 'Control+Shift+Escape': 'Task Manager (Windows)', 'Control+Escape': 'Start menu (Windows)',
  'Alt+Tab': 'Switch windows (Windows)', 'Alt+F4': 'Close the window (Windows)', 'Alt+Escape': 'Cycle windows (Windows)', 'Alt+Space': 'Window menu (Windows)',
  'Control+Alt+Tab': 'Switch windows (Windows)', 'Control+Alt+Delete': 'Windows security screen (cannot be used)', 'PrintScreen': 'Screenshot (Windows)',
  'Control+Alt+C': 'Types © in Word and Outlook', 'Control+Alt+R': 'Types ® in Word and Outlook', 'Control+Alt+T': 'Types ™ in Word and Outlook',
  'Control+Alt+E': 'Types € in Word and Outlook', 'Control+Alt+M': 'New comment in Word', 'Control+Alt+V': 'Paste Special in Word and Excel',
  'Control+Alt+O': 'Outline view in Word', 'Control+Alt+1': 'Heading 1 in Word', 'Control+Alt+2': 'Heading 2 in Word', 'Control+Alt+3': 'Heading 3 in Word',
  'Control+Alt+Up': 'Rotates the screen on some PCs', 'Control+Alt+Down': 'Rotates the screen on some PCs', 'Control+Alt+Left': 'Rotates the screen on some PCs', 'Control+Alt+Right': 'Rotates the screen on some PCs',
  'F1': 'Help in most programs', 'F5': 'Refresh in browsers and Explorer', 'F11': 'Full screen in browsers'
};
const normKey = a => String(a || '').split('+').map(p => p.trim()).sort((x, y) => (['Control', 'Alt', 'Shift', 'Super'].indexOf(x) + 10) % 14 - (['Control', 'Alt', 'Shift', 'Super'].indexOf(y) + 10) % 14).join('+');
// Checks one proposed key against: the app's other actions, Windows and common programs, and anything
// another running program has already registered (found by trying to register it for a moment).
function checkHotkey({ id, accel, all }) {
  const warnings = [], errors = [];
  const parts = String(accel || '').split('+');
  const mods = parts.filter(p => ['Control', 'Alt', 'Shift', 'Super'].includes(p)), key = parts.find(p => !['Control', 'Alt', 'Shift', 'Super'].includes(p));
  if (!key) errors.push('Press a key together with Ctrl or Alt.');
  else if (!mods.some(m => m !== 'Shift') && !/^F\d{1,2}$/.test(key)) errors.push('Use Ctrl or Alt with it, or a function key (F1 to F12), so normal typing is not blocked.');
  for (const [other, acc] of Object.entries(all || {})) if (other !== id && acc && normKey(acc) === normKey(accel)) errors.push(`Already used here for "${HOTKEYS[other]?.label || other}".`);
  const known = KNOWN_KEYS[normKey(accel)] || Object.entries(KNOWN_KEYS).find(([k]) => normKey(k) === normKey(accel))?.[1];
  if (known) warnings.push(`Windows or another program uses this: ${known}. While Read Aloud Pro runs, that program will not get it.`);
  if (mods.includes('Super')) warnings.push('Windows keeps most Windows-key shortcuts for itself; this may not work.');
  if (!errors.length && !Object.values(currentHotkeys()).some(a => normKey(a) === normKey(accel))) {
    let free = false; try { free = globalShortcut.register(accel, () => {}); if (free) globalShortcut.unregister(accel); } catch {}
    if (!free) errors.push('Another program running right now has already taken this key.');
  }
  return { warnings, errors };
}
function buildTrayMenu() {
  const k = currentHotkeys();
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show reader', click: () => createReader(true) },
    { label: `Read highlighted text  (${prettyKey(k.read) || 'no key'})`, click: () => setTimeout(readFromApp, 200) },
    { label: `Read the screen  (${prettyKey(k.screen) || 'no key'})`, click: () => setTimeout(readScreen, 300) },
    { label: 'Manual', click: () => openManual() },
    { label: 'Settings', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Quit Read Aloud Pro', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}
let manualWin = null;
function openManual(section) {
  if (manualWin && !manualWin.isDestroyed()) { manualWin.show(); manualWin.focus(); if (section) manualWin.webContents.executeJavaScript(`location.hash=${JSON.stringify(section)}`).catch(() => {}); return; }
  manualWin = new BrowserWindow({ width: 1100, height: 860, icon: ICON, title: 'Read Aloud Pro – Manual', backgroundColor: '#f6f7f9', webPreferences: { contextIsolation: true, sandbox: true } });
  manualWin.setMenuBarVisibility(false);
  manualWin.loadFile(path.join(RENDERER, 'manual.html'), { hash: section || '' });
}
// ------------------------------------------------------------------ messages from the windows (same shape as the extension)
async function handle(m, e) {
  switch (m.type) {
    case 'read-from-app': readFromApp(); return { ok: true };
    case 'claude': return core.callClaude(m);
    case 'save': {
      const file = core.saveFile(m, app.getPath('downloads'));
      if (m.open) await shell.openPath(file);
      return { where: file, opened: !!m.open };
    }
    case 'outlook-draft': {
      const r = await core.outlookDraft(m.text);
      if (r.ok) return { where: 'Outlook (new draft window)', opened: true };
      const file = core.saveFile({ kind: 'eml', title: 'Email draft', text: m.text }, app.getPath('downloads'));   // new Outlook or no Outlook: open the .eml instead
      await shell.openPath(file);
      return { where: file, opened: true, note: 'Outlook automation unavailable (' + r.error + '); opened the draft file instead.' };
    }
    case 'tts-kokoro': { const s = core.getSettings(); return ai('tts', { text: m.text, voice: m.voice || s.kokoroVoice || 'af_heart' }); }
    case 'kokoro-voices': return ai('voices');
    case 'stt': return ai('stt', { pcm: m.pcm });
    case 'openOptions': openSettings(m.section); return { ok: true };
    case 'open-file': {
      const r = await dialog.showOpenDialog(reader, { title: 'Open a document to read', properties: ['openFile'], filters: [{ name: 'Documents', extensions: ['docx', 'pdf', 'txt', 'md', 'html', 'htm', 'eml'] }] });
      if (r.canceled || !r.filePaths[0]) return { canceled: true };
      const f = r.filePaths[0];
      return { name: path.basename(f), ext: path.extname(f).slice(1).toLowerCase(), base64: fs.readFileSync(f).toString('base64') };
    }
    case 'pick-folder': { const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e?.sender) || undefined, { properties: ['openDirectory'], title: 'Choose your Obsidian vault folder' }); return { path: r.canceled ? '' : r.filePaths[0] }; }
    case 'vault-test': return core.vaultTest();
    case 'vault-list': return { vaults: core.listVaults() };
    case 'update-info': return { version: app.getVersion(), auto: (store.get('settings') || {}).autoUpdate !== false, status: updateStatus };
    case 'update-check': if (!updater) return { status: updateStatus }; try { await updater.checkForUpdates(); } catch {} return { status: updateStatus };    // Test-only (needs the --rap-test switch): connect the in-document highlight to a window found by title,
    // skipping the copy step, so the highlight can be tested without taking the focus from the person.
    case 'src-test-attach': {
      if (!process.argv.includes('--rap-test')) return { error: 'test switch not set' };
      const koffi = require('koffi'), u32 = koffi.load('user32.dll');
      const FindWindowW = u32.func('void* __stdcall FindWindowW(const char16_t*, const char16_t*)');
      const h = FindWindowW(m.cls || null, m.title); if (!h) return { error: 'window not found' };
      return { linked: await src.attach(h) };
    }    case 'src-sentence': src.sentence(m); return { ok: true };
    case 'src-word': src.word(m); return { ok: true };
    case 'src-terms': src.terms(m); return { ok: true };
    case 'src-clear': src.clear(!!m.end); return { ok: true };
    case 'open-manual': openManual(m.section); return { ok: true };
    case 'hotkeys-get': return { keys: currentHotkeys(), labels: Object.fromEntries(Object.entries(HOTKEYS).map(([id, h]) => [id, h.label])), defaults: Object.fromEntries(Object.entries(HOTKEYS).map(([id, h]) => [id, h.def])) };
    case 'hotkeys-suspend': hotkeysSuspended = true; globalShortcut.unregisterAll(); return { ok: true };   // while the person presses keys to record a new one
    case 'hotkeys-resume': hotkeysSuspended = false; registerHotkeys(); return { ok: true };
    case 'hotkey-check': { globalShortcut.unregisterAll(); try { return checkHotkey(m); } finally { if (!hotkeysSuspended) registerHotkeys(); } }
    case 'hotkeys-set': {
      const s = store.get('settings') || {}; store.set({ settings: { ...s, hotkeys: m.keys } });
      const failed = registerHotkeys(); buildTrayMenu(); return { failed };
    }    case 'list-screens': return { sources: await listScreens() };
    case 'read-screen': {
      // A whole screen is captured as shown, so get the reader out of the way first. A window is captured on its own.
      const isScreen = !m.id || m.id.startsWith('screen:');
      if (isScreen) reader?.minimize();
      setTimeout(() => readScreen(m.id, m.name).catch(e => tell('Could not read the screen: ' + e.message)), isScreen ? 500 : 0);
      return { ok: true };
    }
    case 'pdf-text': {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(m.base64, 'base64')), isEvalSupported: false, useSystemFonts: true }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const tc = await (await pdf.getPage(i)).getTextContent();
        pages.push(tc.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n'));
      }
      return { text: pages.join('\n\n') };
    }
    case 'claude-status': return { claude: core.findClaude() };
    case 'badge': return { ok: true };
    default: return { error: 'unknown message ' + m.type };
  }
}

// ------------------------------------------------------------------ start
app.whenReady().then(() => {
  app.setAppUserModelId('com.readaloudpro.app');   // must match the installer's shortcut, or Windows drops notifications
  store.init(app.getPath('userData'));
  if (!store.get('settings')) {
    globalThis.self = globalThis; require('../renderer/defaults.js');
    store.set({ settings: self.RAP_mergeSettings({ engine: 'kokoro', kokoroVoice: 'af_heart', saveTarget: 'folder', savePath: '%USERPROFILE%\\Documents\\Read Aloud Pro Notes' }) });
  }
  core = require('./core'); win = require('./winapi');
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'microphone', 'speaker-selection', 'clipboard-read', 'clipboard-sanitized-write'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ['media', 'microphone', 'speaker-selection', 'clipboard-read', 'clipboard-sanitized-write'].includes(perm));
  ipcMain.handle('store:get', (e, q) => store.getMany(q));
  ipcMain.handle('store:set', (e, o) => { store.set(o); return true; });
  ipcMain.handle('store:remove', (e, k) => { store.remove(k); return true; });
  ipcMain.handle('msg', async (e, m) => { try { return await handle(m, e); } catch (err) { return { error: err.message || String(err) }; } });
  store.onChanged(ch => BrowserWindow.getAllWindows().forEach(w => !w.isDestroyed() && w.webContents.send('store:changed', ch)));

  const failed = registerHotkeys();
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Read Aloud Pro');
  buildTrayMenu();  tray.on('click', () => createReader(true));
  createReader(!process.argv.includes('--hidden'));
  setupUpdates();
  startWorker(); ai('warm').catch(() => {});          // load the voice in the background so the first read is quick
  if (failed.length) notify('These shortcut keys are taken by another program: ' + failed.join(', ') + '. Change them in Settings → Reading & notes → Shortcut keys.');
});
app.on('second-instance', () => createReader(true));
app.on('window-all-closed', e => e.preventDefault?.());
app.on('will-quit', () => { globalShortcut.unregisterAll(); store.flush(); worker?.kill(); });
