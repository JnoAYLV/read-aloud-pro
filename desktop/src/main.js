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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false }
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
  return { text, title: fg.title };
}
const cleanTitle = t => String(t || '').replace(/\s+-\s+(Outlook|Word|Excel|PowerPoint|Adobe Acrobat.*|Google Chrome|Microsoft​? Edge|Notepad)\s*$/i, '').trim() || 'Untitled';

async function readFromApp() {
  let g; try { g = await grabSelection(); } catch (e) { grabLog({ step: 'error', msg: String(e && e.stack || e).slice(0, 600) }); tell('Could not copy the highlighted text: ' + (e && e.message)); return; }
  if (g.inApp) return toReader('command', { type: 'read-selection' });
  grabLog({ step: 'read', chars: g.text.length });
  if (!g.text.trim()) { tell('Nothing highlighted came through. Highlight some text, keep that window in front, then press Ctrl+Alt+R. Or press Ctrl+Alt+O to read the screen.'); return; }
  toReader('load-text', { title: cleanTitle(g.title), text: g.text, from: g.title, autoRead: true });
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
    case 'update-check': if (!updater) return { status: updateStatus }; try { await updater.checkForUpdates(); } catch {} return { status: updateStatus };    case 'open-manual': openManual(m.section); return { ok: true };
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
