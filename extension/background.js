// Read Aloud Pro: background service worker.
// Menus, hotkeys, Claude (through Claude Code on this computer or an API key), the reference library,
// and saving results as notes, Outlook drafts (.eml) or Word documents (.docx).
importScripts('defaults.js', 'docgen.js');

const HOST = 'com.readaloudpro.claude';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const m = (id, title, contexts) => chrome.contextMenus.create({ id, title, contexts });
    m('read-selection', 'Read aloud', ['selection']);
    m('read-here', 'Read page aloud from here', ['page']);
    m('collect-selection', 'Add highlighted text to memory', ['selection']);
    m('collect-page', 'Add this page to memory', ['page']);
    m('scan', 'Find highlight words on this page', ['page', 'selection']);
    m('claude-summarize', 'Summarize with Claude', ['selection']);
  });
});

async function toTab(tab, msg) {
  if (!tab?.id) return;
  try { await chrome.tabs.sendMessage(tab.id, msg); }
  catch {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['defaults.js', 'content.js'] });
      await chrome.tabs.sendMessage(tab.id, msg);
    } catch (e) { console.warn('Read Aloud Pro cannot run on this page:', e.message); }
  }
}
chrome.action.onClicked.addListener(tab => toTab(tab, { type: 'toggle' }));
chrome.commands.onCommand.addListener((cmd, tab) => toTab(tab, { type: cmd }));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'claude-summarize') toTab(tab, { type: 'claude-summarize', text: info.selectionText });
  else if (info.menuItemId === 'collect-selection') toTab(tab, { type: 'collect-selection', text: info.selectionText });
  else toTab(tab, { type: info.menuItemId });
});

// ------------------------------------------------------------------ prompts
const BASE = `You are the writing and analysis assistant inside "Read Aloud Pro", working for an operations leader in air cargo ground handling.
Rules:
- Use only facts found in the MEMORY / SOURCES and the REFERENCE LIBRARY. Never invent numbers, names, dates or times. Mark anything that must be filled in with [brackets].
- Follow the house style and any standard work documents in the library. When you rely on a standard work document, name it.
- Memory items are dated. Treat the most recent as current. If an older item conflicts with a newer one, say so.
- If the request mentions OLDER MEMORY ITEMS that look related (listed by title and date only, content not included), end with one line: "Related older items you may want me to include: <titles>". Never use or guess their content.
- Plain words. No preamble and no comments about yourself.`;

const FORMATS = {
  outlook: `FORMAT: Outlook email. Line 1: "Subject: ...". Line 2 (only if recipients are clear): "To: ..." with names, or email addresses only if they appear in the sources. Then a blank line, then the body: greeting, bottom line first, short paragraphs or "- " bullets, clear asks with owners and dates, sign-off with the user's name if known, else [Your name]. No # headings.`,
  word: `FORMAT: Word document. Start with "# Title". Then a 2-3 line summary. Use "## " headings, short paragraphs, "- " bullets and "1. " numbered steps. **bold** sparingly.`,
  teams: `FORMAT: Microsoft Teams chat message. Short and friendly-professional, 2 to 6 short lines or "- " bullets, no subject line, [@name] placeholders where someone must be tagged.`,
  slack: `FORMAT: Slack message. Short and scannable, "- " bullets, *bold* with single asterisks sparingly, no subject line.`,
  auto: `FORMAT: choose from the request. An email → Outlook email format (Line 1 "Subject: ..."). A document, report, memo, procedure or summary to keep → Word format (start "# Title"). A quick chat note → Teams format. If it is genuinely unclear, reply with only one line: "QUESTION: Should this be an Outlook email, a Word document, or a Teams or Slack message?"`
};
const FORMAT_TAG = `First line of your reply must be exactly one of: "FORMAT: outlook", "FORMAT: word", "FORMAT: teams", "FORMAT: slack". Then the content.`;

const TASKS = {
  write: 'TASK: Write what the user asks for, using the memory and the reference library.',
  summarize: 'TASK: Summarize. Start with a one-sentence bottom line. Then up to 6 short bullets. Call out safety issues and controllable failures by name. If there are several sources, add one line per source with its date.',
  connect: 'TASK: Connect the dots across all sources. List: (1) the same issue, gateway, shift, equipment or role appearing more than once; (2) cause and effect or timing links; (3) contradictions between sources, naming both; (4) gaps between the standard work in the library and what the sources describe; (5) open questions; (6) suggested next actions with [owner] and [date]. Quote 3 to 8 words from a source for each point so it can be found.',
  issues: 'TASK: List every safety issue and every controllable failure, grouped under "Safety" and "Controllable failures". For each: one line on what happened, then a 3 to 8 word quote from the source. If a group has none, write "None found". Do not guess.',
  chat: 'TASK: Answer the user\'s spoken question in 1 to 4 plain sentences that sound natural read aloud. No bullets, no markdown, no lists of links.',
  ping: 'Reply with the single word OK.'
};
const MAX_TOKENS = { write: 4000, summarize: 1500, connect: 3000, issues: 2000, chat: 500, ping: 10 };
const SRC_LIMIT = 200000, KB_LIMIT = 250000;

// ------------------------------------------------------------------ library
async function loadLibrary() {
  const s = await RAP_getSettings();
  const { kbIndex = [] } = await chrome.storage.local.get('kbIndex');
  const docs = [];
  for (const d of kbIndex.filter(d => d.enabled !== false)) {
    const body = (await chrome.storage.local.get('kb:' + d.id))['kb:' + d.id] || {};
    docs.push({ title: d.title, tag: d.tag === 'standard-work' ? 'Standard work' : 'Reference', text: body.text, base64: body.base64, pdf: d.type === 'pdf' });
  }
  for (const b of RAP_BUILTIN_KB.filter(b => s.kbBuiltin[b.id] !== false)) {
    docs.push({ title: b.title, tag: 'Built-in guide', text: await (await fetch(chrome.runtime.getURL(b.file))).text() });
  }
  docs.sort((a, b) => (a.tag === 'Standard work' ? 0 : a.tag === 'Reference' ? 1 : 2) - (b.tag === 'Standard work' ? 0 : b.tag === 'Reference' ? 1 : 2));
  let used = 0; const text = [], pdfs = [], cut = [];
  for (const d of docs) {
    if (d.pdf) { pdfs.push(d); continue; }
    if (used + d.text.length > KB_LIMIT) { cut.push(d.title); continue; }
    used += d.text.length;
    text.push(`<document title="${d.title.replace(/"/g, "'")}" type="${d.tag}">\n${d.text}\n</document>`);
  }
  return { text: text.join('\n\n'), pdfs, cut };
}

function buildMessage({ task, format, sources = [], older = [], extra }) {
  const fmt = task === 'write' ? `${FORMATS[format] || FORMATS.auto}\n${FORMAT_TAG}` : '';
  let used = 0, truncated = false;
  const src = sources.map((s, i) => {
    let t = String(s.text || ''); const room = SRC_LIMIT - used;
    if (t.length > room) { t = t.slice(0, Math.max(0, room)); truncated = true; }
    used += t.length;
    const when = s.added ? new Date(s.added).toLocaleString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'now';
    return `<source n="${i + 1}" title="${String(s.title || '').replace(/"/g, "'")}" saved="${when}"${s.url ? ` url="${s.url}"` : ''}>\n${t}\n</source>`;
  }).join('\n\n');
  const old = older.length ? `\n\nOLDER MEMORY ITEMS NOT INCLUDED (title, saved):\n${older.map(o => `- ${o.title} (${new Date(o.added).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })})`).join('\n')}` : '';
  const req = (extra || '').trim() || (task === 'write' ? 'Write the most useful follow-up based on the sources.' : '');
  return { text: `${TASKS[task] || TASKS.summarize}\n${fmt}\n\nUSER REQUEST: ${req}\n\nMEMORY / SOURCES (newest first):\n${src || '(none)'}${old}`, truncated };
}

function parseReply(task, raw) {
  let text = String(raw || '').trim(), format = null;
  if (/^QUESTION:/i.test(text)) return { question: text.replace(/^QUESTION:\s*/i, '') };
  const m = text.match(/^\s*FORMAT:\s*(outlook|word|teams|slack)\s*\n?/i);
  if (m) { format = m[1].toLowerCase(); text = text.slice(m[0].length).trim(); }
  return { text: text || '(empty reply)', format };
}

// Keep the service worker alive during long requests (Chrome stops idle workers after 30 s).
function keepAlive() { const t = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000); return () => clearInterval(t); }

async function callApi(lib, msg, task, settings) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) throw new Error('No API key saved. Add one in Settings → Claude & library.');
  const system = [{ type: 'text', text: BASE }];
  if (lib.text) system.push({ type: 'text', text: 'REFERENCE LIBRARY\n\n' + lib.text, cache_control: { type: 'ephemeral' } });
  const content = lib.pdfs.map(p => ({ type: 'document', title: p.title, source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } }));
  if (content.length) content[content.length - 1].cache_control = { type: 'ephemeral' };
  content.push({ type: 'text', text: msg });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: settings.model, max_tokens: MAX_TOKENS[task] || 2000, system: task === 'ping' ? BASE : system, messages: [{ role: 'user', content: task === 'ping' ? 'ping' : content }] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = data?.error?.message || res.statusText;
    if (res.status === 401) throw new Error('The API key was rejected. Check it in Settings.');
    if (res.status === 429) throw new Error('Rate limited or out of credit: ' + m);
    throw new Error(`Claude error ${res.status}: ${m}`);
  }
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

function nativeCall(payload) {
  return new Promise((resolve, reject) => {
    let port;
    try { port = chrome.runtime.connectNative(HOST); } catch (e) { return reject(new Error(bridgeHelp(e.message))); }
    let done = false;
    port.onMessage.addListener(r => { done = true; port.disconnect(); r?.error ? reject(new Error(r.error)) : resolve(r); });
    port.onDisconnect.addListener(() => { if (!done) reject(new Error(bridgeHelp(chrome.runtime.lastError?.message || 'The helper closed without answering.'))); });
    port.postMessage(payload);
  });
}
function bridgeHelp(m) {
  return /not found|not installed|forbidden|Specified native messaging host/i.test(m)
    ? 'The Claude Code helper is not installed. Run install-claude-code-bridge.ps1 from the claude-code-bridge folder, then restart Chrome.'
    : m;
}

async function callCode(lib, msg, task, settings) {
  const system = task === 'ping' ? BASE : BASE + (lib.text ? '\n\nREFERENCE LIBRARY\n\n' + lib.text : '') +
    (lib.pdfs.length ? `\n\nMore reference documents are PDF files in the current folder: ${lib.pdfs.map(p => p.title + '.pdf').join(', ')}. Read the ones relevant to the request with the Read tool.` : '');
  const files = task === 'ping' ? [] : lib.pdfs.map(p => ({ name: p.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) + '.pdf', base64: p.base64 }));
  const r = await nativeCall({ type: 'run', system, prompt: task === 'ping' ? 'Reply with the single word OK.' : msg, model: settings.codeModel, files });
  return r.text;
}

async function callClaude(m) {
  const settings = await RAP_getSettings();
  const mode = m.mode || settings.claudeMode;
  if (mode !== 'api' && mode !== 'code') throw new Error('Claude is off. Choose a connection in Settings → Claude & library.');
  const task = TASKS[m.task] ? m.task : 'summarize';
  const lib = task === 'ping' ? { text: '', pdfs: [], cut: [] } : await loadLibrary();
  const { text: msg, truncated } = buildMessage({ ...m, task });
  const stop = keepAlive();
  try {
    const raw = mode === 'api' ? await callApi(lib, msg, task, settings) : await callCode(lib, msg, task, settings);
    const out = parseReply(task, raw);
    out.notes = [];
    if (truncated) out.notes.push('Some source text was cut to fit (200,000 character limit).');
    if (lib.cut.length) out.notes.push(`Library too large; left out: ${lib.cut.join(', ')}.`);
    if (task === 'write' && !out.format && !out.question) out.format = m.format && m.format !== 'auto' ? m.format : 'word';
    return out;
  } finally { stop(); }
}

// ------------------------------------------------------------------ saving
const safeName = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'note';
function stamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`; }

function buildFile({ kind, title, text, source }) {
  if (kind === 'eml') { const e = RAP_doc.makeEml(text); return { ext: 'eml', bytes: e.bytes, name: e.subject || title, mime: 'message/rfc822' }; }
  if (kind === 'docx') {
    const h = String(text).match(/^#\s+(.+)/m);
    return { ext: 'docx', bytes: RAP_doc.makeDocx(text, h ? h[1] : title), name: h ? h[1] : title, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  const md = `# ${title}\n\n${source ? `Source: ${source}\n` : ''}Saved: ${new Date().toLocaleString()}\n\n${text}\n`;
  return { ext: 'md', bytes: new TextEncoder().encode(md), name: title, mime: 'text/markdown' };
}

async function saveFile(m) {
  const s = await RAP_getSettings();
  const f = buildFile(m);
  const fname = `${stamp()} ${safeName(f.name)}.${f.ext}`;
  if (s.saveTarget === 'folder' && s.savePath) {
    const r = await nativeCall({ type: 'save', dir: s.savePath, name: fname, base64: RAP_doc.b64(f.bytes), open: !!m.open });
    return { where: r.path, opened: !!m.open };
  }
  const folder = String(s.saveFolder || 'Read Aloud Notes').split(/[\\/]+/).map(safeName).filter(Boolean).join('/');
  const url = `data:${f.mime};base64,${RAP_doc.b64(f.bytes)}`;
  const id = await chrome.downloads.download({ url, filename: `${folder}/${fname}`, conflictAction: 'uniquify', saveAs: false });
  let opened = false;
  if (m.open) {
    await new Promise(res => { const l = d => { if (d.id === id && d.state?.current === 'complete') { chrome.downloads.onChanged.removeListener(l); res(); } }; chrome.downloads.onChanged.addListener(l); setTimeout(res, 4000); });
    try { await chrome.downloads.open(id); opened = true; } catch { chrome.downloads.show(id); }
  }
  return { where: `Downloads\\${folder.replace(/\//g, '\\')}\\${fname}`, opened };
}

// ------------------------------------------------------------------ ElevenLabs (optional voice)
async function elKey() {
  const { elKey: k } = await chrome.storage.local.get('elKey');
  if (!k) throw new Error('No ElevenLabs key saved. Add it in Settings → Reading & notes.');
  return k;
}
async function elTTS(text) {
  const s = await RAP_getSettings();
  if (!s.elVoice) throw new Error('Pick an ElevenLabs voice in Settings → Reading & notes.');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(s.elVoice)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'xi-api-key': await elKey() },
    body: JSON.stringify({ text, model_id: s.elModel || 'eleven_flash_v2_5' })
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = d?.detail?.message || d?.detail?.status || (typeof d?.detail === 'string' ? d.detail : '') || res.statusText;
    if (res.status === 401) throw new Error('ElevenLabs key rejected or out of characters: ' + m);
    throw new Error(`ElevenLabs error ${res.status}: ${m}`);
  }
  return { audio: d.audio_base64, starts: d.alignment?.character_start_times_seconds || [] };
}
async function elVoices() {
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': await elKey() } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('ElevenLabs: ' + (d?.detail?.message || res.statusText));
  return { voices: (d.voices || []).map(v => ({ id: v.voice_id, name: v.name, category: v.category })) };
}
async function elUsage() {
  const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': await elKey() } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return {};
  return { used: d.character_count, limit: d.character_limit, tier: d.tier, resets: d.next_character_count_reset_unix };
}

// ------------------------------------------------------------------ messages
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'claude': return reply(await callClaude(msg));
        case 'save': return reply(await saveFile(msg));
        case 'bridge-ping': return reply(await nativeCall({ type: 'ping' }));
        case 'tts11': return reply(await elTTS(msg.text));
        case 'el-voices': return reply(await elVoices());
        case 'el-usage': return reply(await elUsage());
        case 'openOptions': chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + (msg.section ? '#' + msg.section : '') }); return reply({ ok: true });
        case 'badge':
          if (sender.tab?.id) {
            await chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#ff3b30' });
            await chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.text || '' });
          }
          return reply({ ok: true });
        default: return reply({ error: 'unknown message' });
      }
    } catch (e) { reply({ error: e.message || String(e) }); }
  })();
  return true;
});
