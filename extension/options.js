const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let S;                  // settings being edited
let editProfiles;       // working copy of profiles (saved with the Save button)
const flash = (el, t, bad) => { el.style.color = bad ? '#c33' : '#2a7'; el.textContent = t; clearTimeout(el._t); el._t = setTimeout(() => el.textContent = '', 5000); };

// ------------------------------------------------------------------ navigation
function show(sec) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.s === sec));
  for (const s of ['highlight', 'reading', 'claude']) $('s-' + s).hidden = s !== sec;
  history.replaceState(null, '', '#' + sec);
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => show(b.dataset.s));

// ------------------------------------------------------------------ highlighting (profiles)
const cur = () => editProfiles[$('profSel').value];
function renderProfiles(selectId) {
  $('profSel').innerHTML = Object.values(editProfiles).map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.id === S.activeProfile ? ' (active)' : ''}</option>`).join('');
  $('profSel').value = selectId && editProfiles[selectId] ? selectId : S.activeProfile in editProfiles ? S.activeProfile : Object.keys(editProfiles)[0];
  renderCats();
}
function renderCats() {
  const p = cur();
  $('cats').innerHTML = p.categories.map((c, i) => `
    <div class="cat" data-i="${i}">
      <div class="top">
        <input type="checkbox" data-k="enabled"${c.enabled !== false ? ' checked' : ''} title="On / off">
        <input type="color" data-k="color" value="${esc(/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#ffcc00')}" title="Highlight colour">
        <input type="text" data-k="label" value="${esc(c.label)}"${c.isName ? ' readonly title="This group is your name"' : ''}>
        ${i > 0 ? '<button data-a="up" title="Move up">↑</button>' : ''}
        ${c.isName ? '' : '<button data-a="del" class="danger" title="Delete group">Delete</button>'}
      </div>
      <textarea data-k="terms" placeholder="${c.isName ? 'Your name(s), e.g. Sam Taylor, Taylor, Sam' : 'Terms, separated by commas'}">${esc(c.terms)}</textarea>
    </div>`).join('');
  $('cats').querySelectorAll('.cat').forEach(el => {
    const c = p.categories[+el.dataset.i];
    el.querySelectorAll('[data-k]').forEach(inp => inp.oninput = () => { c[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value; });
    el.querySelector('[data-a=del]')?.addEventListener('click', () => { if (confirm(`Delete the group "${c.label}"?`)) { p.categories.splice(+el.dataset.i, 1); renderCats(); } });
    el.querySelector('[data-a=up]')?.addEventListener('click', () => { const i = +el.dataset.i; [p.categories[i - 1], p.categories[i]] = [p.categories[i], p.categories[i - 1]]; renderCats(); });
  });
}
$('profSel').onchange = renderCats;
$('addCat').onclick = () => {
  const p = cur(); const used = new Set(p.categories.map(c => c.color));
  const color = RAP_PALETTE.find(c => !used.has(c)) || RAP_PALETTE[p.categories.length % RAP_PALETTE.length];
  p.categories.push({ id: RAP_newId(), label: 'New group', color, enabled: true, terms: '' });
  renderCats();
  const all = $('cats').querySelectorAll('.cat input[data-k=label]'); all[all.length - 1].select();
};
$('resetProf').onclick = () => {
  if (!confirm('Replace this profile\'s groups with the defaults? Your name is kept.')) return;
  const p = cur(); const name = p.categories.find(c => c.isName)?.terms || '';
  p.categories = RAP_DEFAULT_PROFILE().categories; p.categories[0].terms = name; renderCats();
};
$('profNew').onclick = () => {
  const name = prompt('Name for the new profile (e.g. Safety audit, Email triage):'); if (!name) return;
  const id = RAP_newId(); const base = RAP_DEFAULT_PROFILE();
  base.categories[0].terms = cur().categories.find(c => c.isName)?.terms || '';
  editProfiles[id] = { id, name: name.trim(), categories: [base.categories[0]] };
  renderProfiles(id); flash($('msgHL'), 'New profile created with just your name. Add groups, then Save.');
};
$('profDup').onclick = () => {
  const src = cur(); const name = prompt('Name for the copy:', src.name + ' copy'); if (!name) return;
  const id = RAP_newId(); editProfiles[id] = { ...structuredClone(src), id, name: name.trim() };
  renderProfiles(id);
};
$('profRen').onclick = () => { const p = cur(); const n = prompt('New name:', p.name); if (n) { p.name = n.trim(); renderProfiles(p.id); } };
$('profDel').onclick = () => {
  if (Object.keys(editProfiles).length < 2) return flash($('msgHL'), 'Keep at least one profile.', true);
  const p = cur(); if (!confirm(`Delete the profile "${p.name}"?`)) return;
  delete editProfiles[p.id]; renderProfiles();
};
$('saveHL').onclick = async () => {
  for (const p of Object.values(editProfiles)) for (const c of p.categories) { c.label = (c.label || '').trim() || 'Group'; c.terms = (c.terms || '').trim(); }
  const active = editProfiles[S.activeProfile] ? S.activeProfile : $('profSel').value;
  S = await RAP_setSettings({ profiles: structuredClone(editProfiles), activeProfile: active, autoScan: $('autoScan').checked });
  renderProfiles($('profSel').value);
  flash($('msgHL'), 'Saved ✓ Open pages update right away.');
};

// ------------------------------------------------------------------ reading
const readingPatch = () => ({
  clickToRead: $('clickToRead').checked, followScroll: $('followScroll').checked,
  saveFolder: $('saveFolder').value.trim() || RAP_DEFAULTS.saveFolder,
  saveTarget: document.querySelector('input[name=target]:checked')?.value || 'downloads',
  savePath: $('savePath').value.trim()
});
$('saveRD').onclick = async () => {
  const p = readingPatch();
  if (p.saveTarget === 'folder' && !/^([a-z]:\\|\\\\|%\w+%)/i.test(p.savePath)) return flash($('msgRD'), 'Enter a full folder path, e.g. C:\\Users\\you\\My Drive\\Read Aloud', true);
  S = await RAP_setSettings(p); flash($('msgRD'), 'Saved ✓');
};
$('useDrive').onclick = () => { $('savePath').value = '%USERPROFILE%\\My Drive\\Read Aloud'; document.querySelector('input[name=target][value=folder]').checked = true; flash($('msgSave'), 'If your Drive is G:\\My Drive, change the start of the path. Then click Save.'); };
$('testSave').onclick = async () => {
  S = await RAP_setSettings(readingPatch());
  flash($('msgSave'), 'Saving a test note…');
  const r = await chrome.runtime.sendMessage({ type: 'save', kind: 'md', title: 'Read Aloud Pro test note', text: 'If you can read this, saving works.' });
  r?.error ? flash($('msgSave'), '✗ ' + r.error, true) : flash($('msgSave'), '✓ Saved to ' + r.where);
};

// ------------------------------------------------------------------ voice engine and speaker
function renderEngine() {
  document.querySelectorAll('input[name=engine]').forEach(r => r.checked = r.value === S.engine);
  document.querySelectorAll('[data-e]').forEach(d => d.classList.toggle('on', d.dataset.e === S.engine));
}
document.querySelectorAll('input[name=engine]').forEach(r => r.onchange = async () => {
  if (r.value === 'elevenlabs' && !S.elVoice) flash($('msgEl'), 'Save your key and pick a voice, or reading will stop with an error.', true);
  S = await RAP_setSettings({ engine: r.value }); renderEngine();
});
async function elKeyState() { const { elKey } = await chrome.storage.local.get('elKey'); $('elKey').placeholder = elKey ? 'Key saved (hidden). Paste a new one to replace it.' : 'ElevenLabs API key'; return !!elKey; }
$('elSaveKey').onclick = async () => {
  const k = $('elKey').value.trim(); if (!k) return flash($('msgEl'), 'Paste a key first.', true);
  await chrome.storage.local.set({ elKey: k }); $('elKey').value = ''; await elKeyState(); flash($('msgEl'), 'Key saved ✓'); loadElVoices();
};
$('elRemoveKey').onclick = async () => { await chrome.storage.local.remove('elKey'); S = await RAP_setSettings({ engine: 'browser' }); renderEngine(); elKeyState(); flash($('msgEl'), 'Key removed; back to built-in voices.'); };
async function loadElVoices() {
  const r = await chrome.runtime.sendMessage({ type: 'el-voices' });
  if (r?.error) return flash($('msgEl'), '✗ ' + r.error, true);
  $('elVoice').innerHTML = '<option value="">Choose a voice…</option>' + r.voices.map(v => `<option value="${esc(v.id)}"${v.id === S.elVoice ? ' selected' : ''}>${esc(v.name)}${v.category ? ' (' + esc(v.category) + ')' : ''}</option>`).join('');
  const u = await chrome.runtime.sendMessage({ type: 'el-usage' });
  if (u?.limit) flash($('msgEl'), `Plan: ${u.tier}. Used ${u.used.toLocaleString()} of ${u.limit.toLocaleString()} characters this period.`);
}
$('elLoad').onclick = loadElVoices;
$('elVoice').onchange = async e => { S = await RAP_setSettings({ elVoice: e.target.value, elVoiceName: e.target.selectedOptions[0]?.textContent || '' }); };
$('elModel').onchange = async e => { S = await RAP_setSettings({ elModel: e.target.value }); };
$('elTest').onclick = async () => {
  flash($('msgEl'), 'Fetching audio…');
  const r = await chrome.runtime.sendMessage({ type: 'tts11', text: 'This is your Read Aloud Pro voice.' });
  if (r?.error) return flash($('msgEl'), '✗ ' + r.error, true);
  const a = new Audio('data:audio/mpeg;base64,' + r.audio);
  if (S.speakerLabel && a.setSinkId) { const d = (await navigator.mediaDevices.enumerateDevices()).find(x => x.kind === 'audiooutput' && x.label === S.speakerLabel); if (d) await a.setSinkId(d.deviceId).catch(() => {}); }
  a.play(); flash($('msgEl'), '✓ Playing');
};
async function listSpeakers(ask) {
  try {
    if (ask) { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop()); }
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    if (!outs.some(o => o.label)) { if (ask) flash($('msgSpk'), 'Speaker names are hidden until the microphone is allowed.', true); return; }
    $('speaker').innerHTML = '<option value="">Windows default speaker</option>' + outs.map(o => `<option${o.label === S.speakerLabel ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    if (ask) flash($('msgSpk'), `Found ${outs.length} speaker${outs.length === 1 ? '' : 's'}.`);
  } catch (e) { flash($('msgSpk'), '✗ ' + e.message, true); }
}
$('listSpk').onclick = () => listSpeakers(true);
$('speaker').onchange = async e => { S = await RAP_setSettings({ speakerLabel: e.target.value }); flash($('msgSpk'), 'Saved ✓'); };

// ------------------------------------------------------------------ Claude connection
function renderMode() {
  document.querySelectorAll('input[name=mode]').forEach(r => r.checked = r.value === S.claudeMode);
  document.querySelectorAll('.mode').forEach(d => d.classList.toggle('on', d.dataset.m === S.claudeMode));
}
document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = async () => { S = await RAP_setSettings({ claudeMode: r.value }); renderMode(); });
$('codeModel').onchange = async e => { S = await RAP_setSettings({ codeModel: e.target.value }); };
$('model').onchange = async e => { S = await RAP_setSettings({ model: e.target.value }); };
$('testCode').onclick = async () => {
  flash($('msgCode'), 'Testing… (can take 10 to 30 seconds)');
  const r = await chrome.runtime.sendMessage({ type: 'claude', mode: 'code', task: 'ping', sources: [] });
  r?.error ? flash($('msgCode'), '✗ ' + r.error, true) : flash($('msgCode'), '✓ Claude Code answered: ' + r.text.slice(0, 40));
};
async function keyState() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  $('apiKey').placeholder = apiKey ? 'Key saved (hidden). Paste a new one to replace it.' : 'sk-ant-…';
}
$('saveKey').onclick = async () => {
  const k = $('apiKey').value.trim(); if (!k) return flash($('msgKey'), 'Paste a key first.', true);
  await chrome.storage.local.set({ apiKey: k }); $('apiKey').value = ''; keyState(); flash($('msgKey'), 'Key saved ✓');
};
$('removeKey').onclick = async () => { await chrome.storage.local.remove('apiKey'); keyState(); flash($('msgKey'), 'Key removed.'); };
$('testKey').onclick = async () => {
  flash($('msgKey'), 'Testing…');
  const r = await chrome.runtime.sendMessage({ type: 'claude', mode: 'api', task: 'ping', sources: [] });
  r?.error ? flash($('msgKey'), '✗ ' + r.error, true) : flash($('msgKey'), '✓ Key works');
};

// ------------------------------------------------------------------ reference library
async function kbIndex() { return (await chrome.storage.local.get({ kbIndex: [] })).kbIndex; }
async function setKbIndex(ix) { await chrome.storage.local.set({ kbIndex: ix }); }
const builtinCache = {};
async function builtinText(b) { return builtinCache[b.id] ??= await (await fetch(chrome.runtime.getURL(b.file))).text(); }
const kb = n => n >= 1000 ? Math.round(n / 1000) + 'k chars' : n + ' chars';

async function renderKB() {
  const ix = await kbIndex(); let total = 0; const rows = [];
  for (const b of RAP_BUILTIN_KB) {
    const t = await builtinText(b); const on = S.kbBuiltin[b.id] !== false; if (on) total += t.length;
    rows.push(`<tr><td><input type="checkbox" data-b="${b.id}"${on ? ' checked' : ''}></td><td>${esc(b.title)}</td><td>Built-in</td><td>${kb(t.length)}</td>
      <td><button data-vb="${b.id}">View</button> <button data-cb="${b.id}" title="Copy into the library so you can edit it; switches the built-in off">Make editable copy</button></td></tr>`);
  }
  for (const d of ix) {
    const on = d.enabled !== false; if (on) total += d.size;
    rows.push(`<tr><td><input type="checkbox" data-u="${d.id}"${on ? ' checked' : ''}></td><td>${esc(d.title)}</td>
      <td><select data-t="${d.id}"><option value="standard-work"${d.tag === 'standard-work' ? ' selected' : ''}>Standard work</option><option value="reference"${d.tag !== 'standard-work' ? ' selected' : ''}>Reference</option></select></td>
      <td>${d.type === 'pdf' ? 'PDF, ' + Math.round(d.bytes / 1024) + ' KB' : kb(d.size)}</td>
      <td>${d.type === 'pdf' ? '' : `<button data-vu="${d.id}">View / edit</button> `}<button data-du="${d.id}" class="danger">Delete</button></td></tr>`);
  }
  $('kbBody').innerHTML = rows.join('');
  $('kbTotal').textContent = `Switched on: about ${kb(total)} of text (about ${Math.round(total / 4000)}k tokens) sent with each request${ix.some(d => d.type === 'pdf' && d.enabled !== false) ? ', plus PDFs' : ''}.` + (total > 250000 ? ' ⚠ Over 250k characters: the library will be cut to fit. Switch some documents off.' : '');
  $('kbBody').querySelectorAll('[data-b]').forEach(cb => cb.onchange = async () => { S = await RAP_setSettings({ kbBuiltin: { ...S.kbBuiltin, [cb.dataset.b]: cb.checked } }); renderKB(); });
  $('kbBody').querySelectorAll('[data-u]').forEach(cb => cb.onchange = async () => { await setKbIndex((await kbIndex()).map(d => d.id === cb.dataset.u ? { ...d, enabled: cb.checked } : d)); renderKB(); });
  $('kbBody').querySelectorAll('[data-t]').forEach(sel => sel.onchange = async () => { await setKbIndex((await kbIndex()).map(d => d.id === sel.dataset.t ? { ...d, tag: sel.value } : d)); });
  $('kbBody').querySelectorAll('[data-vb]').forEach(b => b.onclick = async () => { const d = RAP_BUILTIN_KB.find(x => x.id === b.dataset.vb); openDlg(d.title, await builtinText(d)); });
  $('kbBody').querySelectorAll('[data-cb]').forEach(b => b.onclick = async () => {
    const d = RAP_BUILTIN_KB.find(x => x.id === b.dataset.cb);
    await addDoc({ title: d.title.replace(/\s*\(.*\)$/, '') + ' (my copy)', text: await builtinText(d), tag: 'reference' });
    S = await RAP_setSettings({ kbBuiltin: { ...S.kbBuiltin, [d.id]: false } });
    renderKB(); flash($('msgKB'), 'Copy added and the built-in switched off. Click View / edit on the copy.');
  });
  $('kbBody').querySelectorAll('[data-vu]').forEach(b => b.onclick = async () => {
    const d = (await kbIndex()).find(x => x.id === b.dataset.vu); const body = (await chrome.storage.local.get('kb:' + d.id))['kb:' + d.id];
    openDlg(d.title, body.text, async (title, text) => {
      await chrome.storage.local.set({ ['kb:' + d.id]: { text } });
      await setKbIndex((await kbIndex()).map(x => x.id === d.id ? { ...x, title: title || x.title, size: text.length } : x)); renderKB();
    });
  });
  $('kbBody').querySelectorAll('[data-du]').forEach(b => b.onclick = async () => {
    const d = (await kbIndex()).find(x => x.id === b.dataset.du); if (!confirm(`Delete "${d.title}" from the library?`)) return;
    await chrome.storage.local.remove('kb:' + d.id); await setKbIndex((await kbIndex()).filter(x => x.id !== d.id)); renderKB();
  });
}
async function addDoc({ title, text, base64, bytes, tag }) {
  const id = RAP_newId();
  const entry = { id, title, tag, enabled: true, added: Date.now(), type: base64 ? 'pdf' : 'text', size: base64 ? 0 : text.length, bytes: bytes || 0 };
  await chrome.storage.local.set({ ['kb:' + id]: base64 ? { base64 } : { text } });
  await setKbIndex([...(await kbIndex()), entry]);
}
$('upFile').onchange = async e => {
  const files = [...e.target.files]; let ok = 0;
  for (const f of files) {
    try {
      const ext = f.name.split('.').pop().toLowerCase(); const title = f.name.replace(/\.[^.]+$/, '');
      if (ext === 'pdf') {
        if (f.size > 25 * 1024 * 1024) throw new Error('PDF over 25 MB');
        const buf = new Uint8Array(await f.arrayBuffer()); let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        await addDoc({ title, base64: btoa(bin), bytes: f.size, tag: $('upTag').value });
      } else {
        let text;
        if (ext === 'docx') text = await RAP_docxText(await f.arrayBuffer());
        else if (ext === 'html' || ext === 'htm') text = new DOMParser().parseFromString(await f.text(), 'text/html').body.innerText;
        else text = await f.text();
        if (!text.trim()) throw new Error('no text found');
        await addDoc({ title, text, tag: $('upTag').value });
      }
      ok++;
    } catch (err) { flash($('msgKB'), `✗ ${f.name}: ${err.message}`, true); }
  }
  e.target.value = '';
  if (ok) flash($('msgKB'), `Added ${ok} document${ok > 1 ? 's' : ''} ✓`);
  renderKB();
};
$('pasteDoc').onclick = () => openDlg('New document', '', async (title, text) => {
  if (!text.trim()) return; await addDoc({ title: title || 'Pasted document', text, tag: $('upTag').value }); renderKB();
}, true);

// ------------------------------------------------------------------ dialog
let dlgSave = null;
function openDlg(title, text, onSave, withName) {
  $('dlgTitle').textContent = title; dlgSave = onSave || null;
  $('dlgPre').hidden = !!onSave; $('dlgEdit').hidden = !onSave; $('dlgSave').hidden = !onSave;
  $('dlgName').hidden = !onSave; $('dlgName').value = withName ? '' : title;
  $('dlgPre').textContent = text; $('dlgEdit').value = text;
  $('dlg').showModal();
}
$('dlgClose').onclick = () => $('dlg').close();
$('dlgSave').onclick = async () => { if (dlgSave) await dlgSave($('dlgName').value.trim(), $('dlgEdit').value); $('dlg').close(); };

// ------------------------------------------------------------------ load
(async () => {
  S = await RAP_getSettings();
  editProfiles = structuredClone(S.profiles);
  renderProfiles();
  $('autoScan').checked = !!S.autoScan;
  $('clickToRead').checked = !!S.clickToRead; $('followScroll').checked = !!S.followScroll; $('saveFolder').value = S.saveFolder;
  $('savePath').value = S.savePath || ''; document.querySelectorAll('input[name=target]').forEach(r => r.checked = r.value === S.saveTarget);
  $('codeModel').value = S.codeModel; $('model').value = S.model; $('extId').textContent = chrome.runtime.id;
  renderMode(); keyState(); renderKB();
  renderEngine(); $('elModel').value = S.elModel;
  if (S.elVoice) $('elVoice').innerHTML = `<option value="${esc(S.elVoice)}">${esc(S.elVoiceName || S.elVoice)}</option>`;
  if (S.speakerLabel) $('speaker').innerHTML += `<option selected>${esc(S.speakerLabel)}</option>`;
  elKeyState(); listSpeakers(false);
  const h = location.hash.slice(1); if (['highlight', 'reading', 'claude'].includes(h)) show(h);
})();
