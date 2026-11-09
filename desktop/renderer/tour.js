// Walkthroughs and "i" help for the desktop app.
// RAP_TOURS holds, for every panel tab and Settings tab, the steps shown the first time that tab is opened.
// Each step points at one control (outlined and scrolled into view) and says what it is for and how to use it.
// Seen walkthroughs are remembered in settings.tourSeen; Settings has a button to show them all again.
(() => {
  const M = {                       // manual sections (ids made by tools/make-manual.js)
    glance: 'the-reader-window-and-panel-at-a-glance', reading: 'reading-aloud', find: 'find-your-name-and-the-words-that-matter',
    memory: 'memory-collecting-what-claude-should-work-from', claude: 'claude-understand-research-and-write',
    library: 'reference-library-standard-work-and-obsidian-vault', voice: 'voice-commands', keys: 'shortcuts-and-settings',
    privacy: 'privacy-what-stays-on-your-pc-and-what-goes-to-claude', setup: 'install-and-first-time-setup'
  };
  // target: a CSS selector. In the panel, "doc:" means the reader page itself, not the panel.
  self.RAP_TOURS = {
    read: { title: 'Read tab', manual: M.reading, steps: [
      { t: 'Welcome to Read Aloud Pro', b: 'It reads text from any program aloud, highlighting each word as it is spoken, marks what matters to you, and helps you understand and reply with Claude. This short walkthrough appears the first time you open each tab. The ? button at the top of the panel opens the full manual any time.' },
      { s: '#rsel', t: 'Read highlighted', b: 'Reads the text you highlighted. Anywhere on your PC, the quickest way is: highlight text in Outlook, Word, a PDF or a web page, then press Ctrl+Alt+R. If nothing is highlighted here, this button fetches it from the program you were just using.' },
      { s: '#rpage', t: 'Read page', b: 'Reads everything in the reader, from the top.' },
      { s: '#play', t: 'Controls', b: '⏮ and ⏭ go back or forward one sentence, ⏯ pauses and resumes, ⏹ stops. Tip: Alt+click any word in the text to start reading from there.' },
      { s: '#voice', t: 'Voice and speed', b: 'Pick a voice. The natural voices are free and stay on your PC. Most people take in work email well at 1.2x to 1.5x speed.' },
      { s: 'doc:#openFile', t: 'Other ways to get text in', b: 'Open file reads Word, PDF and email files. Paste reads what you copied. Read screen lets you pick a screen or window and reads the text in it, even scanned documents.' },
      { s: '#mic', t: 'Voice commands', b: 'Click 🎤 (or press Ctrl+Alt+V), say a command such as "read last paragraph" or "summarize", then pause. Say "help" to hear them all.' }
    ] },
    find: { title: 'Find tab', manual: M.find, steps: [
      { t: 'Find what matters', b: 'This tab colours your name and word groups such as safety, controllable failures and deadlines, counts them, and lets you jump to each one, so the line that concerns you is never missed.' },
      { s: '#myname', t: 'Your name', b: 'Type your name the ways people write it, with commas between, for example: Sam Taylor, Taylor, Sam.' },
      { s: '#prof', t: 'Profiles', b: 'A profile is a saved set of word groups for one kind of job, such as email triage or a safety audit. Edit groups opens Settings to change terms and colours.' },
      { s: '#scan', t: 'Scan this page', b: 'Colours and counts every hit in the reader. Clear removes the colours.' },
      { s: '#cats', t: 'Your hits', b: 'Each group shows its colour and count. Use ‹ › to step through hits, and ▶ read from here to hear that spot.' }
    ] },
    ai: { title: 'Claude tab', manual: M.claude, steps: [
      { t: 'Understand and write with Claude', b: 'Claude explains, summarizes and drafts from the material you collect. It never sends anything: emails open as Outlook drafts for you to send. Claude stays off until you turn it on.' },
      { s: '#useCode', t: 'Turn Claude on', b: 'Uses your own Claude Code login on this PC. It checks the login in 10 to 30 seconds, then switches on.' },
      { s: '#addsel', t: 'Memory', b: 'Collect what Claude should work from: + Highlighted, + This page, + Paste, or Ctrl+Alt+M in any program. Items are dated; today\'s are used, and Claude tells you about related older ones.' },
      { s: '#vaultSel', t: 'Notes from Obsidian', b: 'Pick a vault and Claude also looks there for related notes when it writes, researches or answers. Summaries never use it. Off by default.' }
    ] },
    // Shown the first time the Claude tab is opened with Claude switched on (those buttons are hidden while it is off).
    aiOn: { title: 'Claude tab', manual: M.claude, steps: [
      { t: 'Claude is on', b: 'Here is what each button does. Every answer says which sources it used.' },
      { s: '[data-task=summarize]', t: 'Understand it', b: 'Summarize gives a spoken-style briefing. Connect the dots finds patterns and gaps across sources. List issues pulls out safety issues and controllable failures. Research explains the phrase you highlighted, using your documents and the web.' },
      { s: '#extra', t: 'Say what you want', b: 'The request box steers every button. Be specific: who it is for, how long, what to include.' },
      { s: '[data-task=write]', t: 'Write', b: 'Pick Outlook email, Word document, Teams or Slack, then press Write. Read the draft, then Open in Outlook (a draft you send yourself), Open in Word, or Copy.' }
    ] },
    highlight: { title: 'Highlighting settings', manual: M.find, steps: [
      { t: 'Highlighting', b: 'Choose what the Find tab looks for: your name and groups of words, each in its own colour. Every option has an i button with more detail.' },
      { s: '#profSel', t: 'Profiles', b: 'Saved sets of word groups. New starts with just your name; Duplicate copies the current one.' },
      { s: '#cats', t: 'Word groups', b: 'Each group has an on/off tick, a colour and its terms, separated by commas. Plurals match on their own; injur* matches any ending. Type your name in the first group\'s box.' },
      { s: '#addCat', t: 'Add a group', b: 'Add a group for anything you track, such as a customer, an aircraft type or a project.' },
      { s: '#saveHL', t: 'Save', b: 'Changes here take effect after Save.' }
    ] },
    reading: { title: 'Reading & notes settings', manual: M.reading, steps: [
      { t: 'Reading & notes', b: 'Voice, microphone, speaker, reading behaviour, where files are saved, and your shortcut keys.' },
      { s: '#kokoroVoice', t: 'Voice', b: 'Natural voices run on this PC for free. Play a test sentence to compare them.' },
      { s: '#micSel', t: 'Microphone', b: 'The mic voice commands listen to. Use Test and watch the green bar; if it does not move, pick another mic.' },
      { s: '#speaker', t: 'Speaker', b: 'Send the voice to a headset or a particular speaker.' },
      { s: '#savePath', t: 'Where files go', b: 'Notes, emails and documents are saved here. A Google Drive or OneDrive folder uploads on its own.' },
      { s: '#hkTable', t: 'Shortcut keys', b: 'Click a box and press new keys to change a shortcut. ✗ means it cannot be used; ⚠ means Windows or another program also uses it.' }
    ] },
    claude: { title: 'Claude & library settings', manual: M.library, steps: [
      { t: 'Claude & library', b: 'How Claude connects, which Obsidian vault it may search, and the documents it must follow.' },
      { s: '[data-m=code]', t: 'Connection', b: 'Claude Code on this computer uses your Claude plan with no extra cost per use. An API key is billed per use. Off keeps everything on your PC.' },
      { s: '#vaultOn', t: 'Obsidian vault', b: 'Pick a vault and tick the box; Test shows how many notes it can search. Leave out vaults with private notes.' },
      { s: '#upFile', t: 'Reference library', b: 'Upload your current standard work and references. Claude follows them every time it writes. Keep them current.' }
    ] }
  };

  // ---------------------------------------------------------------- walkthrough card
  let active = null;
  self.RAP_runTour = function (key, { root = document, host, avoid, onDone, openManual } = {}) {
    const tour = self.RAP_TOURS[key]; if (!tour || active) return;
    const find = sel => !sel ? null : sel.startsWith('doc:') ? document.querySelector(sel.slice(4)) : root.querySelector(sel);
    const visible = el => el && el.getClientRects().length > 0;
    const steps = tour.steps.filter(st => !st.s || visible(find(st.s)));
    if (!steps.length) return;
    let i = 0, lit = null;
    const card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    Object.assign(card.style, { position: 'fixed', zIndex: 2147483647, boxSizing: 'border-box', width: '330px', background: '#fffbe6', color: '#1d2330', border: '2px solid #e0b400',
      borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,.35)', padding: '14px 16px', font: '14px/1.5 "Segoe UI",system-ui,sans-serif' });
    card.style.left = '-10000px'; card.style.top = '0';                 // off screen until it has been measured and placed
    (host || document.documentElement).appendChild(card);         // last in the page, so it sits above the docked panel
    const unlight = () => { if (lit) { lit.style.outline = lit.dataset.rapOutline || ''; lit.style.outlineOffset = ''; lit = null; } };
    const close = all => { unlight(); card.remove(); active = null; onDone && onDone(all); };
    const btn = (label, primary, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn;
      Object.assign(b.style, { marginLeft: '6px', padding: '5px 11px', borderRadius: '7px', cursor: 'pointer', font: 'inherit', border: '1px solid ' + (primary ? '#c79a00' : '#c8ccd3'), background: primary ? '#ffd84a' : '#fff', color: '#1d2330' }); return b; };
    // Beside the control, never covering it and never running off the window. When the control is in the
    // docked panel, the card goes left of the whole panel; if there is no room there, above or below the control.
    function place(el) {
      const W = innerWidth, H = innerHeight, cw = Math.min(330, W - 16);
      card.style.width = cw + 'px';
      const ch = card.offsetHeight || 200, r = el ? el.getBoundingClientRect() : null;
      const inPanel = avoid && el && (avoid.contains(el) || el.getRootNode?.().host === avoid);   // panel controls live in its shadow root
      const a = inPanel ? avoid.getBoundingClientRect() : null;
      const edge = a ? a.left : r ? r.left : 0;
      let left, top;
      const free = avoid ? avoid.getBoundingClientRect().left : W;           // the reading area, left of the panel
      if (!r) { left = free - cw - 16 >= 8 ? (free - cw) / 2 : (W - cw) / 2; top = (H - ch) / 2; }
      else if (edge - cw - 12 >= 8) { left = edge - cw - 12; top = r.top + r.height / 2 - ch / 2; }
      else { left = r.left + r.width / 2 - cw / 2; top = r.bottom + 10 + ch <= H - 8 ? r.bottom + 10 : r.top - ch - 10; }
      card.style.left = Math.max(8, Math.min(W - cw - 8, left)) + 'px';
      card.style.top = Math.max(8, Math.min(H - ch - 8, top)) + 'px';
    }
    addEventListener('resize', () => active === card && place(lit));
    function render() {
      unlight();
      const st = steps[i], el = find(st.s);
      card.replaceChildren();
      const top = document.createElement('div'); top.style.cssText = 'font-size:12px;color:#7a6400;margin-bottom:4px';
      top.textContent = `${tour.title} · ${i + 1} of ${steps.length}`;
      const h = document.createElement('div'); h.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:4px'; h.textContent = st.t;
      const p = document.createElement('div'); p.textContent = st.b;
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;margin-top:12px';
      const skip = document.createElement('a'); skip.textContent = 'Skip all walkthroughs'; skip.href = '#';
      skip.style.cssText = 'font-size:12px;color:#7a6400;flex:1'; skip.onclick = e => { e.preventDefault(); close(true); };
      row.appendChild(skip);
      if (openManual) row.appendChild(btn('Manual', false, () => openManual(tour.manual)));
      if (i > 0) row.appendChild(btn('Back', false, () => { i--; render(); }));
      row.appendChild(btn(i === steps.length - 1 ? 'Done' : 'Next', true, () => { if (i === steps.length - 1) close(false); else { i++; render(); } }));
      card.append(top, h, p, row);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.dataset.rapOutline = el.style.outline; el.style.outline = '3px solid #e0b400'; el.style.outlineOffset = '2px'; lit = el; }
      place(el); requestAnimationFrame(() => place(el)); setTimeout(() => place(el), 350);
    }
    card.addEventListener('keydown', e => { if (e.key === 'Escape') close(false); });
    active = card; render();
  };
  // Run a tab's walkthrough once: the first time that tab is shown.
  // opts.then runs afterwards (straight away if this walkthrough was already seen), unless the person skipped all.
  self.RAP_maybeTour = async function (key, opts = {}) {
    const s = await self.RAP_getSettings();
    if ((s.tourSeen || {}).all) return;
    if ((s.tourSeen || {})[key] || active) { opts.then && !active && opts.then(); return; }
    self.RAP_runTour(key, { ...opts, onDone: async all => {
      const cur = await self.RAP_getSettings();
      await self.RAP_setSettings({ tourSeen: all ? { ...(cur.tourSeen || {}), all: true } : { ...(cur.tourSeen || {}), [key]: true } });
      if (!all && opts.then) setTimeout(opts.then, 300);
    } });
  };

  // ---------------------------------------------------------------- "i" help buttons
  let pop = null;
  self.RAP_info = function (afterEl, text, section, openManual) {
    if (!afterEl || afterEl.dataset.rapInfo) return;
    afterEl.dataset.rapInfo = '1';
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'i'; b.title = 'What is this?'; b.setAttribute('aria-label', 'What is this?');
    Object.assign(b.style, { width: '20px', height: '20px', minWidth: '20px', padding: '0', marginLeft: '6px', borderRadius: '50%', border: '1px solid #9aa3b2', background: '#fff',
      color: '#3b4a63', font: 'italic 700 12px Georgia,serif', cursor: 'pointer', verticalAlign: 'middle', lineHeight: '18px' });
    b.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      if (pop) { const same = pop.anchor === b; pop.remove(); pop = null; if (same) return; }
      pop = document.createElement('div'); pop.anchor = b;
      Object.assign(pop.style, { position: 'absolute', zIndex: 99999, maxWidth: '360px', background: '#fffbe6', border: '1px solid #e0b400', borderRadius: '9px',
        boxShadow: '0 6px 20px rgba(0,0,0,.2)', padding: '10px 12px', font: '13.5px/1.5 "Segoe UI",system-ui,sans-serif', color: '#1d2330', fontStyle: 'normal', fontWeight: 'normal' });
      const t = document.createElement('div'); t.textContent = text; pop.appendChild(t);
      if (section && openManual) { const a = document.createElement('a'); a.href = '#'; a.textContent = 'More in the manual'; a.style.cssText = 'display:inline-block;margin-top:6px;font-size:12.5px';
        a.onclick = ev => { ev.preventDefault(); openManual(section); }; pop.appendChild(a); }
      document.body.appendChild(pop);
      const r = b.getBoundingClientRect();
      pop.style.left = Math.min(scrollX + r.left, scrollX + innerWidth - 380) + 'px'; pop.style.top = (scrollY + r.bottom + 6) + 'px';
    };
    if (afterEl.tagName === 'LABEL' || afterEl.tagName === 'H2') afterEl.appendChild(b); else afterEl.insertAdjacentElement('afterend', b);
    return b;
  };
  document.addEventListener('click', e => { if (pop && !pop.contains(e.target)) { pop.remove(); pop = null; } });
  self.RAP_MANUAL = M;
})();
