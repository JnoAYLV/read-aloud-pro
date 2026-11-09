// Desktop-only parts of the Settings page: the Kokoro voice list, test button and microphone choice.
(async () => {
  const $ = id => document.getElementById(id);
  const s = await RAP_getSettings();
  const r = await chrome.runtime.sendMessage({ type: 'kokoro-voices' });
  const nice = v => `${v.name || v.id} (${/^b/.test(v.id) ? 'British' : 'American'} ${/^.m_/.test(v.id) ? 'male' : 'female'})`;
  $('kokoroVoice').innerHTML = (r?.voices || []).map(v => `<option value="${v.id}"${v.id === s.kokoroVoice ? ' selected' : ''}>${nice(v)}</option>`).join('') || '<option>Voices unavailable</option>';
  $('kokoroVoice').onchange = e => RAP_setSettings({ kokoroVoice: e.target.value, engine: 'kokoro' }).then(() => { document.querySelector('input[name=engine][value=kokoro]').checked = true; });
  $('kTest').onclick = async () => {
    $('msgK').textContent = 'Generating…';
    const a = await chrome.runtime.sendMessage({ type: 'tts-kokoro', text: 'This is your Read Aloud Pro voice. The departure was late by twenty two minutes.', voice: $('kokoroVoice').value });
    if (a?.error) { $('msgK').textContent = '✗ ' + a.error; return; }
    const audio = new Audio('data:audio/wav;base64,' + a.audio);
    const cur = await RAP_getSettings();
    if (cur.speakerLabel && audio.setSinkId) { const d = (await navigator.mediaDevices.enumerateDevices()).find(x => x.kind === 'audiooutput' && x.label === cur.speakerLabel); if (d) await audio.setSinkId(d.deviceId).catch(() => {}); }
    audio.play(); $('msgK').textContent = '✓ Playing';
  };
  // Microphone for push-to-talk: list, save by name, and a 3-second level test.
  // Microphone names stay hidden until the mic has been opened once, so open it for an instant first.
  await navigator.mediaDevices.getUserMedia({ audio: true }).then(st => st.getTracks().forEach(t => t.stop())).catch(() => {});
  const mics = (await navigator.mediaDevices.enumerateDevices()).filter(x => x.kind === 'audioinput' && !/^(default|communications)$/.test(x.deviceId));
  $('micSel').innerHTML = '<option value="">Windows default microphone</option>' + mics.map(m => `<option${m.label === s.micLabel ? ' selected' : ''}>${m.label.replace(/[<>&"]/g, '')}</option>`).join('');
  $('micSel').onchange = e => RAP_setSettings({ micLabel: e.target.value }).then(() => { $('msgMic').textContent = 'Saved ✓'; });
  $('micTest').onclick = async () => {
    const label = $('micSel').value; const dev = mics.find(m => m.label === label);
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: dev ? { deviceId: { exact: dev.deviceId } } : true }); }
    catch (e) { $('msgMic').textContent = '✗ ' + e.message; return; }
    const ctx = new AudioContext(); const an = ctx.createAnalyser(); ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize); let peak = 0; $('msgMic').textContent = 'Listening… say something';
    const iv = setInterval(() => { an.getFloatTimeDomainData(buf); let s2 = 0; for (const v of buf) s2 += v * v; const rms = Math.sqrt(s2 / buf.length); peak = Math.max(peak, rms); $('micBar').style.width = Math.min(100, rms * 800) + '%'; }, 60);
    setTimeout(() => { clearInterval(iv); stream.getTracks().forEach(t => t.stop()); ctx.close(); $('micBar').style.width = '0';
      $('msgMic').textContent = peak > 0.012 ? '✓ Heard you. This microphone works.' : '✗ Heard nothing from this microphone. Pick another one and test again.'; }, 3000);
  };  // Obsidian vault: off until ticked. Saved paths may use %USERPROFILE%.
  const vl = (await chrome.runtime.sendMessage({ type: 'vault-list' }).catch(() => null))?.vaults || [];
  if (vl.length) {
    const pick = document.createElement('select'); pick.style.minWidth = '200px'; pick.title = 'Vaults Obsidian knows about on this PC';
    pick.innerHTML = '<option value="">Pick one of your vaults…</option>' + vl.map(v => `<option value="${v.path.replace(/"/g, '&quot;')}">${v.label.replace(/</g, '&lt;')}</option>`).join('');
    pick.onchange = async () => { if (!pick.value) return; $('vaultPath').value = pick.value; await saveVault(); $('msgVault').textContent = 'Saved ✓ Tick the box above to switch it on.'; };
    $('vaultPick').before(pick);
  }  $('vaultOn').checked = !!s.vaultOn; $('vaultPath').value = s.vaultPath || ''; $('vaultExclude').value = s.vaultExclude ?? '';
  const saveVault = () => RAP_setSettings({ vaultOn: $('vaultOn').checked, vaultPath: $('vaultPath').value.trim(), vaultExclude: $('vaultExclude').value });
  $('vaultOn').onchange = async () => { await saveVault(); $('msgVault').textContent = $('vaultOn').checked ? 'On ✓' : 'Off'; };
  $('vaultSave').onclick = async () => { await saveVault(); $('msgVault').textContent = 'Saved ✓'; };
  $('vaultPick').onclick = async () => { const r = await chrome.runtime.sendMessage({ type: 'pick-folder' }); if (r?.path) { $('vaultPath').value = r.path; await saveVault(); $('msgVault').textContent = 'Saved ✓'; } };
  $('vaultTest').onclick = async () => { await saveVault(); const r = await chrome.runtime.sendMessage({ type: 'vault-test' });
    $('msgVault').textContent = r?.error ? '✗ ' + r.error : `✓ Found ${r.notes.toLocaleString()} notes${$('vaultOn').checked ? '' : ' (tick the box to use them)'}`; };  // Shortcut keys: click a box, press the keys; each choice is checked before it can be saved.
  const hk = await chrome.runtime.sendMessage({ type: 'hotkeys-get' });
  if (hk?.keys) {
    let keys = { ...hk.keys }; const problems = {};
    const pretty = a => a ? a.replace(/Control/g, 'Ctrl').replace(/Super/g, 'Win').replace(/\+/g, ' + ') : 'none';
    const CODE = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Escape', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace',
      Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/',
      Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`', PrintScreen: 'PrintScreen' };
    const toAccel = e => {
      let key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^F\d{1,2}$/.test(e.code) ? e.code : /^Numpad\d$/.test(e.code) ? 'num' + e.code.slice(6) : CODE[e.code];
      if (!key) return null;
      return [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', key].filter(Boolean).join('+');
    };
    const tbody = document.querySelector('#hkTable tbody');
    const render = () => {
      tbody.innerHTML = '';
      for (const id of Object.keys(keys)) {
        const tr = document.createElement('tr');
        const name = document.createElement('td'); name.textContent = hk.labels[id];
        const cell = document.createElement('td');
        const box = document.createElement('input'); box.type = 'text'; box.readOnly = true; box.value = pretty(keys[id]); box.style.width = '200px'; box.title = 'Click, then press the new keys. Esc cancels, Backspace clears.';
        const note = document.createElement('div'); note.className = 'hint'; note.style.margin = '4px 0 0';
        const p = problems[id];
        if (p) { note.innerHTML = ''; for (const t of p.errors) { const d = document.createElement('div'); d.style.color = '#b3261e'; d.textContent = '✗ ' + t; note.appendChild(d); } for (const t of p.warnings) { const d = document.createElement('div'); d.style.color = '#8a5a00'; d.textContent = '⚠ ' + t; note.appendChild(d); } }
        box.onfocus = () => { box.value = 'Press the new keys…'; chrome.runtime.sendMessage({ type: 'hotkeys-suspend' }); };
        box.onblur = () => { box.value = pretty(keys[id]); chrome.runtime.sendMessage({ type: 'hotkeys-resume' }); };
        box.onkeydown = async e => {
          e.preventDefault();
          if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;              // wait for the main key
          if (e.code === 'Escape' && !e.ctrlKey && !e.altKey) return box.blur();
          if (e.code === 'Backspace' && !e.ctrlKey && !e.altKey) { keys[id] = ''; problems[id] = { errors: [], warnings: ['No key: this action will only work from the panel.'] }; render(); return; }
          const accel = toAccel(e); if (!accel) return;
          keys[id] = accel;
          problems[id] = await chrome.runtime.sendMessage({ type: 'hotkey-check', id, accel, all: keys });
          render(); $('msgHk').textContent = 'Not saved yet.';
        };
        cell.append(box, note); tr.append(name, cell); tbody.appendChild(tr);
      }
    };
    render();
    $('hkSave').onclick = async () => {
      const bad = Object.entries(problems).filter(([, p]) => p?.errors?.length);
      if (bad.length) { $('msgHk').textContent = '✗ Fix the keys marked ✗ first.'; return; }
      const r = await chrome.runtime.sendMessage({ type: 'hotkeys-set', keys });
      $('msgHk').textContent = r?.failed?.length ? '⚠ Saved, but these could not be set: ' + r.failed.join(', ') : 'Saved ✓ The new keys work now.';
    };
    $('hkReset').onclick = async () => { keys = { ...hk.defaults }; for (const k of Object.keys(problems)) delete problems[k]; render(); $('msgHk').textContent = 'Defaults restored. Click Save to use them.'; };
  }
  // The manual, from the top of Settings.
  const man = document.createElement('button'); man.textContent = '? Manual'; man.style.marginLeft = '12px'; man.onclick = () => chrome.runtime.sendMessage({ type: 'open-manual' });
  document.querySelector('h1')?.appendChild(man);  // "i" buttons: a plain explanation next to every option, with a link to that part of the manual.
  const openMan = sec => chrome.runtime.sendMessage({ type: 'open-manual', section: sec });
  const MM = self.RAP_MANUAL || {};
  const lab = id => document.getElementById(id)?.closest('label');
  const h2 = text => [...document.querySelectorAll('h2')].find(h => h.textContent.trim().startsWith(text));
  const radio = (name, value) => document.querySelector(`input[name=${name}][value=${value}]`)?.closest('label');
  const INFO = [
    // Highlighting
    [lab('profSel'), 'A profile is a saved set of word groups for one kind of job (for example Email triage, Safety audit). The Find tab uses the active profile. Switch profiles here or in the Find tab.', MM.find],
    [document.getElementById('profDel'), 'New makes a profile with just your name. Duplicate copies the current profile so you can adjust it. Rename changes its name. Delete removes it (at least one must remain).', MM.find],
    [document.getElementById('addCat'), 'Adds a word group. Give it a name, a colour and its terms separated by commas. Plurals match automatically; a * at the end matches any ending (injur* = injury, injured). Untick a group to switch it off without deleting it. The first group is your name.', MM.find],
    [document.getElementById('resetProf'), 'Puts this profile back to the original groups: Your name, Safety, Controllable failures, Actions & deadlines. Your name is kept.', MM.find],
    [lab('autoScan'), 'When on, every new text in the reader is coloured and counted as soon as it loads. When off (the default), click Scan this page in the Find tab.', MM.find],
    [document.getElementById('saveHL'), 'Profiles, groups and colours take effect after Save.', MM.find],
    // Reading & notes
    [radio('engine', 'kokoro'), 'Natural voices that run on this PC: free, private (nothing leaves the PC) and work offline after a one-time download. The highlight follows each sentence and can be a word ahead or behind inside a sentence.', MM.reading],
    [document.getElementById('kTest'), 'Plays a short sentence in the chosen voice on the chosen speaker, so you can compare voices.', MM.reading],
    [radio('engine', 'browser'), 'Windows\' own voices. They sound robotic but highlight each word exactly. Choose a specific one from the voice list in the panel.', MM.reading],
    [document.getElementById('micTest'), 'The microphone voice commands listen to. Press Test and talk for 3 seconds: if the green bar moves, it works. Virtual mics such as SteelSeries Sonar only pass sound when their program is running and routing your real mic.', MM.voice],
    [document.getElementById('listSpk'), 'Which speaker or headset the natural voice plays on, for example a headset so calls stay on your main speaker. List my speakers refreshes the list.', MM.reading],
    [lab('clickToRead'), 'Alt+click any word in the reader to start reading from that word.', MM.reading],
    [lab('followScroll'), 'Scrolls the reader so the line being read stays on screen.', MM.reading],
    [radio('target', 'downloads'), 'Saves notes, drafts and documents in a folder inside your Downloads folder.', MM.keys],
    [radio('target', 'folder'), 'Saves to any folder, for example Documents\\Read Aloud Pro Notes or a Google Drive or OneDrive folder (files there upload on their own). Use Test save to check the folder works.', MM.keys],
    [document.getElementById('testSave'), 'Writes a small test file to the chosen folder and tells you whether it worked.', MM.keys],
    [document.getElementById('hkReset'), 'Click a box and press the keys you want. ✗ means it cannot be used (already used here, taken by another running program, or no Ctrl/Alt). ⚠ means Windows or another program uses it too; that program will not get those keys while Read Aloud Pro runs. Backspace in a box removes the key. Save to apply; Back to the defaults restores the originals.', MM.keys],
    [document.getElementById('saveRD'), 'Saves the reading and file options on this tab. Voice, microphone, speaker and shortcut keys save on their own.', MM.keys],
    // Claude & library
    [radio('mode', 'off'), 'Claude is not used. Reading, Find and voice commands still work; nothing leaves your PC.', MM.privacy],
    [radio('mode', 'code'), 'Uses your Claude Code login on this PC. Answers count against your Claude plan, with no separate bill. Needs Claude Code installed and signed in; Test connection checks it.', MM.claude],
    [document.getElementById('codeModel'), 'Haiku is fastest, Sonnet is the recommended balance, Opus gives the best answers but is slowest.', MM.claude],
    [radio('mode', 'api'), 'Uses an Anthropic API key, billed per use separately from any Claude subscription. The key is stored only on this PC.', MM.claude],
    [document.getElementById('model'), 'The model used with an API key. Sonnet is recommended; Haiku is cheapest; Opus is best.', MM.claude],
    [lab('vaultOn'), 'When ticked, Claude also looks in this Obsidian vault for related notes when it writes, researches, answers or connects the dots. Only the few matching notes are sent, and each answer lists them. Summaries never use the vault. You can also pick the vault in the Claude tab or say "connect my … vault".', MM.library],
    [document.getElementById('vaultPick'), 'Choose the vault folder yourself, or pick from the list of vaults Obsidian knows on this PC.', MM.library],
    [document.getElementById('vaultTest'), 'Folders to skip are never searched (for example Templates, Attachments, or anything private). Test shows how many notes can be searched.', MM.library],
    [h2('Reference library'), 'Documents Claude reads every time before it writes. Built-in guides cover email writing, house style, operations and aviation ground operations. Add your current standard work as "Standard work" so Claude follows it and points out gaps against it. Keep it current: an outdated document gives outdated answers.', MM.library],
    [lab('upTag'), 'Standard work ranks first and is named when Claude relies on it. Reference is background material.', MM.library],
    [document.getElementById('pasteDoc'), 'Add text you cannot upload as a file, for example a page from an intranet, as a library document.', MM.library]
  ];
  for (const [el, text, sec] of INFO) self.RAP_info?.(el, text, sec, openMan);

  // Updates: version, automatic on/off, check now. New versions come from the app's GitHub releases.
  const ui0 = await chrome.runtime.sendMessage({ type: 'update-info' });
  if (ui0?.version) {
    const sec = document.getElementById('s-reading');
    const h = document.createElement('h2'); h.textContent = 'Updates';
    const row1 = document.createElement('label'); row1.className = 'chk';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'autoUpdate'; cb.checked = ui0.auto;
    row1.append(cb, ' Install updates automatically (checks when the app starts and every 4 hours)');
    const row2 = document.createElement('div'); row2.className = 'row';
    const ver = document.createElement('span'); ver.textContent = 'This is version ' + ui0.version + '.';
    const now = document.createElement('button'); now.textContent = 'Check now'; now.style.marginLeft = '10px';
    const msg = document.createElement('span'); msg.className = 'msg'; msg.textContent = ui0.status;
    row2.append(ver, now, msg);
    const save = sec.querySelector('#saveRD')?.closest('.row');
    for (const el of [h, row1, row2]) sec.insertBefore(el, save || null);
    cb.onchange = async () => { await RAP_setSettings({ autoUpdate: cb.checked }); msg.textContent = cb.checked ? 'Automatic updates on ✓' : 'Automatic updates off. Use Check now when you want one.'; };
    now.onclick = async () => { msg.textContent = 'Checking…'; const r = await chrome.runtime.sendMessage({ type: 'update-check' }); msg.textContent = r?.status || 'Done.'; };
    self.RAP_info?.(row1, 'New versions are published by the person who maintains the app. When one is out, it downloads in the background and the app asks before restarting. If you choose Later, it installs the next time you quit from the tray. Untick to stop automatic updates; Check now still works.', MM.setup, openMan);
  }  // Walkthroughs: the first time each Settings tab is opened. Plus a button to see them all again.
  const tourFor = sec => setTimeout(() => self.RAP_maybeTour?.(sec, { openManual: openMan }), 250);
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => tourFor(b.dataset.s)));
  tourFor(document.querySelector('nav button.on')?.dataset.s || 'highlight');
  const again = document.createElement('button'); again.textContent = 'Show the walkthroughs again'; again.style.marginLeft = '8px';
  again.onclick = async () => { await RAP_setSettings({ tourSeen: {} }); tourFor(document.querySelector('nav button.on')?.dataset.s || 'highlight'); again.textContent = 'Walkthroughs reset ✓ (each tab shows its own again)'; };
  document.querySelector('h1')?.appendChild(again);  // ElevenLabs voices need the ElevenLabs service; the desktop app does not include it yet.
  const el = document.querySelector('[data-e=elevenlabs]'); if (el) el.style.display = 'none';
})();
