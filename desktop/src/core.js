// Read Aloud Pro desktop: Claude (via Claude Code on this PC, or an API key), the reference library,
// and building/saving Outlook drafts, Word documents and notes. Ported from the browser extension.
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFile } = require('child_process');
globalThis.self = globalThis;
require('../renderer/defaults.js');
require('../renderer/docgen.js');
const store = require('./store');

const RENDERER = path.join(__dirname, '..', 'renderer');
// PowerShell can't run scripts from inside the packaged app archive; the installer unpacks them next to it.
const SCRIPTS = __dirname.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
const getSettings = () => self.RAP_mergeSettings(store.get('settings'));

// ------------------------------------------------------------------ prompts (same as the extension)
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
  summarize: 'TASK: Help the user understand this email or document quickly. They will LISTEN to your answer read aloud, so brief them the way a sharp assistant would in person. Start with the bottom line in one or two sentences. Then, in short plain paragraphs, explain who is asking for what, what it means for the user, what they need to do and by when, and anything unusual. Mention safety issues and controllable failures plainly if there are any. If there are several sources, say which one each point comes from, by its title and date, in words.',
  connect: 'TASK: Connect the dots across all sources, as a spoken briefing. Cover, in this order and in plain sentences: the same issue, gateway, shift, equipment or role appearing more than once; cause and effect or timing links; contradictions between sources, naming both; gaps between the standard work in the library and what the sources describe; open questions; and suggested next actions with [owner] and [date]. For each point, quote a few words from the source so it can be found.',
  issues: 'TASK: Go through every safety issue, then every controllable failure, as a spoken briefing. Start a paragraph with "Safety issues." and another with "Controllable failures." For each item say in one or two sentences what happened, then quote a few words from the source. If a group has none, say "None found." Do not guess.',
  research: 'TASK: Research and explain. The user does not fully understand the FOCUS text (or the question in USER REQUEST). Explain it in plain words to someone who will LISTEN: what it means, why it matters here, the background needed, and what the user might do about it. Use the sources, the reference library and any notes first. Then use web search for terms, acronyms, regulations, systems, companies or events that are still unclear. Say which parts came from their documents and which from the web, naming websites in words (for example "according to the FAA website"). In web searches use only general terms: never people\'s names, internal numbers, gateway codes or confidential content from the sources.',
  chat: 'TASK: Answer the user\'s spoken question in 1 to 4 plain sentences that sound natural read aloud. No bullets, no markdown, no lists of links.',
  ping: 'Reply with the single word OK.'
};
const MAX_TOKENS = { write: 4000, summarize: 1500, connect: 3000, issues: 2000, research: 3000, chat: 500, ping: 10 };
// Everything except a written email or document is read aloud, so it must be plain spoken text.
const SPOKEN = 'OUTPUT: plain text that reads naturally aloud. No markdown at all: no asterisks, pound signs, underscores, backticks, tables, links, emoji, or bullet symbols. Short paragraphs separated by a blank line. Write abbreviations and symbols the way a person would say them when that helps (for example \"percent\" not \"%\").';
const SPOKEN_TASKS = new Set(['summarize', 'connect', 'issues', 'research', 'chat']);
const SRC_LIMIT = 200000, KB_LIMIT = 250000;

function loadLibrary() {
  const s = getSettings(), docs = [];
  for (const d of (store.get('kbIndex') || []).filter(d => d.enabled !== false)) {
    const body = store.get('kb:' + d.id) || {};
    docs.push({ title: d.title, tag: d.tag === 'standard-work' ? 'Standard work' : 'Reference', text: body.text, base64: body.base64, pdf: d.type === 'pdf' });
  }
  for (const b of self.RAP_BUILTIN_KB.filter(b => s.kbBuiltin[b.id] !== false)) {
    docs.push({ title: b.title, tag: 'Built-in guide', text: fs.readFileSync(path.join(RENDERER, b.file), 'utf8') });
  }
  const rank = t => t === 'Standard work' ? 0 : t === 'Reference' ? 1 : 2;
  docs.sort((a, b) => rank(a.tag) - rank(b.tag));
  let used = 0; const text = [], pdfs = [], cut = [];
  for (const d of docs) {
    if (d.pdf) { pdfs.push(d); continue; }
    if (used + d.text.length > KB_LIMIT) { cut.push(d.title); continue; }
    used += d.text.length; text.push(`<document title="${d.title.replace(/"/g, "'")}" type="${d.tag}">\n${d.text}\n</document>`);
  }
  return { text: text.join('\n\n'), pdfs, cut };
}
function buildMessage({ task, format, sources = [], older = [], extra, focus }) {
  const fmt = task === 'write' ? `${FORMATS[format] || FORMATS.auto}\n${FORMAT_TAG}` : SPOKEN_TASKS.has(task) ? SPOKEN : '';
  let used = 0, truncated = false;
  const src = sources.map((s, i) => {
    let t = String(s.text || ''); const room = SRC_LIMIT - used;
    if (t.length > room) { t = t.slice(0, Math.max(0, room)); truncated = true; }
    used += t.length;
    const when = s.added ? new Date(s.added).toLocaleString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'now';
    return `<source n="${i + 1}" title="${String(s.title || '').replace(/"/g, "'")}" saved="${when}"${s.url ? ` from="${s.url}"` : ''}>\n${t}\n</source>`;
  }).join('\n\n');
  const old = older.length ? `\n\nOLDER MEMORY ITEMS NOT INCLUDED (title, saved):\n${older.map(o => `- ${o.title} (${new Date(o.added).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })})`).join('\n')}` : '';
  const req = (extra || '').trim() || (task === 'write' ? 'Write the most useful follow-up based on the sources.' : '');
  const foc = focus && String(focus).trim() ? `\n\nFOCUS (the text the user highlighted and wants explained):\n${String(focus).trim().slice(0, 8000)}` : '';
  return { text: `${TASKS[task] || TASKS.summarize}\n${fmt}\n\nUSER REQUEST: ${req}${foc}\n\nMEMORY / SOURCES (newest first):\n${src || '(none)'}${old}`, truncated };
}
function parseReply(raw) {
  let text = String(raw || '').trim(), format = null;
  if (/^QUESTION:/i.test(text)) return { question: text.replace(/^QUESTION:\s*/i, '') };
  const m = text.match(/^\s*FORMAT:\s*(outlook|word|teams|slack)\s*\n?/i);
  if (m) { format = m[1].toLowerCase(); text = text.slice(m[0].length).trim(); }
  return { text: text || '(empty reply)', format };
}

// ------------------------------------------------------------------ Obsidian vault (optional, off until switched on in Settings)
// A plain keyword search over the vault's notes on this PC. The best few matches go to Claude with the request.
const expandPath = p => String(p || '').replace(/%(\w+)%/g, (_, v) => process.env[v] || process.env[v.toUpperCase()] || '');
const STOP = new Set(('the and for that this with from have will your you are was were been their they them what when where which who would could should about into there these those than then also just only over more most some such very can not but our out all any its please thanks thank team hello regards need needs make made like know want get got let new one two use used using each other same per via may might must does did doing done here').split(' '));
function keywords(text, n = 25) {
  const counts = new Map();
  for (const w of String(text).toLowerCase().match(/[a-z0-9][a-z0-9'\-]{2,}/g) || []) { if (STOP.has(w) || /^\d+$/.test(w)) continue; counts.set(w, (counts.get(w) || 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}
let vaultCache = { key: '', at: 0, files: [] };
function vaultFiles(root, exclude) {
  const key = root + '|' + exclude.join(',');
  if (vaultCache.key === key && Date.now() - vaultCache.at < 120000) return vaultCache.files;
  const out = [], skip = new Set(exclude.map(x => x.toLowerCase()));
  (function walk(dir, depth) {
    if (depth > 12 || out.length >= 20000) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || skip.has(e.name.toLowerCase())) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (/\.md$/i.test(e.name)) out.push(p);
    }
  })(root, 0);
  vaultCache = { key, at: Date.now(), files: out };
  return out;
}
function vaultSettings() {
  const s = getSettings();
  return { on: !!s.vaultOn, root: expandPath(s.vaultPath), exclude: String(s.vaultExclude || '').split(',').map(x => x.trim()).filter(Boolean) };
}
function searchVault(query, max = 5) {
  const v = vaultSettings();
  if (!v.on || !v.root) return { notes: [] };
  if (!fs.existsSync(v.root)) return { notes: [], error: `Obsidian vault folder not found: ${v.root}` };
  const kws = keywords(query); if (!kws.length) return { notes: [] };
  const need = kws.length >= 3 ? 2 : 1, scored = [];
  for (const file of vaultFiles(v.root, v.exclude)) {
    let text; try { if (fs.statSync(file).size > 2e6) continue; text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const low = text.toLowerCase(), title = path.basename(file, '.md').toLowerCase();
    let hits = 0, score = 0;
    for (const k of kws) {
      let c = 0, i = low.indexOf(k); while (i >= 0 && c < 20) { c++; i = low.indexOf(k, i + k.length); }
      if (c) { hits++; score += 1 + Math.log(c); }
      if (title.includes(k)) score += 3;
    }
    if (hits >= need) scored.push({ file, text, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const notes = scored.slice(0, max).map(({ file, text }) => {
    // Keep the paragraphs that mention the request's words, up to ~5,000 characters per note.
    const paras = text.split(/\n\s*\n/), keep = []; let n = 0;
    for (const p of paras) { if (n > 5000) break; const l = p.toLowerCase(); if (kws.some(k => l.includes(k))) { keep.push(p); n += p.length; } }
    let mtime = Date.now(); try { mtime = fs.statSync(file).mtimeMs; } catch {}
    return { title: 'Obsidian note: ' + path.relative(v.root, file).replace(/\.md$/i, ''), text: (keep.length ? keep.join('\n\n') : text).slice(0, 5000), added: mtime };
  });
  return { notes, searched: vaultCache.files.length };
}
// The vaults Obsidian itself knows about on this PC (from its own settings file), for the pickers.
function listVaults() {
  let reg = {}; try { reg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'obsidian', 'obsidian.json'), 'utf8')).vaults || {}; } catch {}
  const seen = new Set(), list = [];
  for (const v of Object.values(reg)) {
    const p = v && v.path; if (!p || seen.has(p.toLowerCase()) || !fs.existsSync(p)) continue;
    seen.add(p.toLowerCase()); list.push({ name: path.basename(p), path: p });
  }
  for (const v of list) if (list.filter(x => x.name === v.name).length > 1) v.label = `${v.name} (in ${path.basename(path.dirname(v.path))})`;
  return list.map(v => ({ name: v.name, label: v.label || v.name, path: v.path })).sort((a, b) => a.label.localeCompare(b.label));
}
function vaultTest() {
  const v = vaultSettings();
  if (!v.root) return { error: 'Choose the vault folder first.' };
  if (!fs.existsSync(v.root)) return { error: 'Folder not found: ' + v.root };
  vaultCache.at = 0;
  return { notes: vaultFiles(v.root, v.exclude).length, root: v.root };
}
// Safety net: answers that are read aloud must not contain markdown symbols, even if Claude slips.
function plainText(t) {
  return String(t)
    .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*/g, ''))
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '')
    .replace(/^[ \t]*[-*•+][ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1').replace(/[*#`]/g, '')
    .replace(/^[ \t]*\|.*\|[ \t]*$/gm, l => l.replace(/^\s*\||\|\s*$/g, '').split('|').map(c => c.trim()).filter(c => !/^:?-+:?$/.test(c)).join(', '))
    .replace(/\n{3,}/g, '\n\n').trim();
}

// ------------------------------------------------------------------ Claude Code on this PC
function findClaude() {
  const c = [path.join(os.homedir(), '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd')];
  for (const dir of (process.env.PATH || '').split(';')) if (dir) c.push(path.join(dir, 'claude.exe'), path.join(dir, 'claude.cmd'));
  return c.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}
function runClaudeCode({ system, prompt, model, files = [], web = false }) {
  return new Promise((resolve, reject) => {
    const exe = findClaude();
    if (!exe) return reject(new Error('Claude Code is not installed on this PC. Install it from claude.com/claude-code and sign in.'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-'));
    const sys = path.join(dir, '_system.txt'); fs.writeFileSync(sys, system, 'utf8');
    for (const f of files) fs.writeFileSync(path.join(dir, f.name), Buffer.from(f.base64, 'base64'));
    const tools = [...(files.length ? ['Read'] : []), ...(web ? ['WebSearch', 'WebFetch'] : [])].join(',');
    const args = ['-p', '--safe-mode', '--no-session-persistence', '--output-format', 'json', '--model', model || 'sonnet', '--tools', tools, ...(tools ? ['--allowedTools', tools] : []), '--system-prompt-file', sys];
    const p = spawn(exe, args, { cwd: dir, windowsHide: true, shell: exe.endsWith('.cmd') });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    const timer = setTimeout(() => { p.kill(); reject(new Error('Claude Code took longer than 6 minutes and was stopped.')); }, 360000);
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', () => {
      clearTimeout(timer); fs.rmSync(dir, { recursive: true, force: true });
      let r; try { r = JSON.parse(out); } catch { return reject(new Error('Claude Code gave no answer. ' + (err || out).slice(0, 300))); }
      if (r.is_error) {
        if (/authenticat|log ?in|OAuth|expired/i.test(r.result || '')) return reject(new Error('Claude Code is not signed in, or the login expired. Open a terminal, type  claude  then  /login.'));
        return reject(new Error('Claude Code error: ' + r.result));
      }
      resolve(String(r.result || ''));
    });
    p.stdin.end(prompt, 'utf8');
  });
}
async function callApi(lib, msg, task, s) {
  const apiKey = store.get('apiKey');
  if (!apiKey) throw new Error('No API key saved. Add one in Settings → Claude & library.');
  const system = [{ type: 'text', text: BASE }];
  if (lib.text) system.push({ type: 'text', text: 'REFERENCE LIBRARY\n\n' + lib.text, cache_control: { type: 'ephemeral' } });
  const content = lib.pdfs.map(p => ({ type: 'document', title: p.title, source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } }));
  if (content.length) content[content.length - 1].cache_control = { type: 'ephemeral' };
  content.push({ type: 'text', text: msg });
  // Research may search the web. Newer models take the dynamic-filtering version of the tool; older ones the basic one.
  const newer = /opus-(4-[678]|5)|sonnet-(4-6|5)|fable|mythos/.test(String(s.model));
  const tools = task === 'research' ? [{ type: newer ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 5 }] : undefined;
  const messages = [{ role: 'user', content: task === 'ping' ? 'ping' : content }];
  let text = '';
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: s.model, max_tokens: MAX_TOKENS[task] || 2000, system: task === 'ping' ? BASE : system, messages, ...(tools ? { tools } : {}) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 401 ? 'The API key was rejected. Check it in Settings.' : `Claude error ${res.status}: ${data?.error?.message || res.statusText}`);
    if (data.stop_reason === 'refusal') throw new Error('Claude declined this request.');
    text += (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (data.stop_reason !== 'pause_turn') break;                      // a long web search pauses; send it back to continue
    messages.push({ role: 'assistant', content: data.content });
  }
  return text;
}
async function callClaude(m) {
  const s = getSettings(), mode = m.mode || s.claudeMode;
  if (mode !== 'api' && mode !== 'code') throw new Error('Claude is off. Choose a connection in Settings → Claude & library.');
  const task = TASKS[m.task] ? m.task : 'summarize';
  const lib = task === 'ping' ? { text: '', pdfs: [], cut: [] } : loadLibrary();
  // Obsidian notes help with writing, research and questions (not summaries, which must stay true to the email).
  let vault = { notes: [] };
  if (['write', 'research', 'chat', 'connect'].includes(task)) {
    const q = [m.extra, m.focus, ...(m.sources || []).map(x => String(x.text || '').slice(0, 3000))].filter(Boolean).join('\n');
    try { vault = searchVault(q); } catch (e) { vault = { notes: [], error: 'Obsidian search failed: ' + e.message }; }
  }
  const { text: msg, truncated } = buildMessage({ ...m, task, sources: [...(m.sources || []), ...vault.notes] });
  let raw;
  if (mode === 'api') raw = await callApi(lib, msg, task, s);
  else {
    const system = task === 'ping' ? BASE : BASE + (lib.text ? '\n\nREFERENCE LIBRARY\n\n' + lib.text : '') +
      (lib.pdfs.length ? `\n\nMore reference documents are PDF files in the current folder: ${lib.pdfs.map(p => p.title + '.pdf').join(', ')}. Read the ones relevant to the request with the Read tool.` : '');
    const files = task === 'ping' ? [] : lib.pdfs.map(p => ({ name: p.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) + '.pdf', base64: p.base64 }));
    raw = await runClaudeCode({ system, prompt: task === 'ping' ? 'Reply with the single word OK.' : msg, model: s.codeModel, files, web: task === 'research' });
  }
  const out = parseReply(raw); out.notes = [];
  if (out.text && SPOKEN_TASKS.has(task)) out.text = plainText(out.text);
  if (vault.notes.length) out.notes.push(`Also used ${vault.notes.length} Obsidian note${vault.notes.length === 1 ? '' : 's'}: ${vault.notes.map(n => n.title.replace(/^Obsidian note: /, '')).join(', ')}.`);
  if (vault.error) out.notes.push(vault.error);
  if (truncated) out.notes.push('Some source text was cut to fit (200,000 character limit).');
  if (lib.cut.length) out.notes.push(`Library too large; left out: ${lib.cut.join(', ')}.`);
  if (task === 'write' && !out.format && !out.question) out.format = m.format && m.format !== 'auto' ? m.format : 'word';
  return out;
}

// ------------------------------------------------------------------ saving and opening
const safeName = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'note';
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`; };
function saveDir(downloadsDir) {
  const s = getSettings();
  if (s.saveTarget === 'folder' && s.savePath) return s.savePath.replace(/%(\w+)%/g, (_, v) => process.env[v] || process.env[v.toUpperCase()] || '');
  return path.join(downloadsDir, ...String(s.saveFolder || 'Read Aloud Notes').split(/[\\/]+/).map(safeName));
}
function saveFile({ kind, title, text, source }, downloadsDir) {
  let bytes, ext, name = title;
  if (kind === 'eml') { const e = self.RAP_doc.makeEml(text); bytes = Buffer.from(e.bytes); ext = 'eml'; name = e.subject || title; }
  else if (kind === 'docx') { const h = String(text).match(/^#\s+(.+)/m); bytes = Buffer.from(self.RAP_doc.makeDocx(text, h ? h[1] : title)); ext = 'docx'; name = h ? h[1] : title; }
  else { bytes = Buffer.from(`# ${title}\n\n${source ? `Source: ${source}\n` : ''}Saved: ${new Date().toLocaleString()}\n\n${text}\n`, 'utf8'); ext = 'md'; }
  const dir = saveDir(downloadsDir); fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `${stamp()} ${safeName(name)}.${ext}`), i = 1;
  while (fs.existsSync(file)) file = path.join(dir, `${stamp()} ${safeName(name)} (${i++}).${ext}`);
  fs.writeFileSync(file, bytes);
  return file;
}
// A real Outlook compose window via Outlook's own automation (classic Outlook). Never sends.
function outlookDraft(text) {
  return new Promise(resolve => {
    const e = self.RAP_doc.splitEmail(text);
    const html = self.RAP_doc.emailHtml(e.body).replace(/^<html><body[^>]*>|<\/body><\/html>$/g, '');
    const j = path.join(os.tmpdir(), `rap-draft-${Date.now()}.json`);
    fs.writeFileSync(j, JSON.stringify({ subject: e.subject, to: (e.to.match(/[^\s,;<>]+@[^\s,;<>]+/g) || []).join('; '), cc: (e.cc.match(/[^\s,;<>]+@[^\s,;<>]+/g) || []).join('; '), html }), 'utf8');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, 'outlook.ps1'), '-JsonPath', j], { windowsHide: true, timeout: 60000 }, (err, stdout) => {
      fs.rmSync(j, { force: true });
      const out = String(stdout || '').trim();
      resolve(out.endsWith('OK') ? { ok: true } : { error: (out.replace(/^ERROR\s*/, '') || err?.message || 'Outlook did not respond') });
    });
  });
}
function ocrImage(png, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, 'ocr.ps1'), '-Png', png], { windowsHide: true, timeout: 60000, maxBuffer: 20e6 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).split('\n')[0]));
      let lines = []; try { lines = JSON.parse(stdout || '[]'); } catch { return reject(new Error('Text recognition gave no result')); }
      if (!Array.isArray(lines)) lines = [lines];
      // Drop window furniture (toolbars, icons, tab bars): lines above skipTop, and lines with fewer than
      // two real words (3+ letters), which on screen captures are almost always buttons or icons misread as text.
      lines = lines.filter(l => l.y >= (opts.skipTop || 0) && (String(l.t).match(/\p{L}{3,}/gu) || []).length >= 2);
      // Rebuild paragraphs: a gap of more than ~1.8 line heights, or a jump back to the left after a short line, starts a new one.
      const paras = []; let cur = [], prev = null;
      for (const l of lines) {
        if (prev && (l.y - prev.y > Math.max(prev.h, l.h) * 1.8 || l.y < prev.y)) { paras.push(cur.join(' ')); cur = []; }
        cur.push(l.t); prev = l;
      }
      if (cur.length) paras.push(cur.join(' '));
      resolve(paras.join('\n'));
    });
  });
}
module.exports = { callClaude, saveFile, outlookDraft, ocrImage, getSettings, findClaude, vaultTest, listVaults, plainText, searchVault, keywords };
