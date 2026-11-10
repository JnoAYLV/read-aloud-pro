// Reader window: shows text grabbed from other programs, files or the screen, and starts reading it.
(() => {
  const doc = document.getElementById('doc');
  const status = t => { const s = document.getElementById('status'); s.textContent = t; s.style.display = t ? 'block' : 'none'; clearTimeout(status.t); if (t) status.t = setTimeout(() => s.style.display = 'none', 5000); };
  function show({ title, text, from, autoRead, linked }) {
    __rap.stopReading(true);                                                // silent: loading new text is not 'stop' (that would disconnect the original)
    window.__rapSrcLinked = !!linked;                                         // highlight inside the original program too
    if (!linked) window.rapBridge.send({ type: 'src-clear', end: true });
    doc.replaceChildren();
    const h = document.createElement('h1'); h.textContent = title || 'Untitled'; h.dataset.rapNoread = '1'; doc.appendChild(h);
    if (from) { const s = document.createElement('div'); s.className = 'src'; s.dataset.rapNoread = '1'; s.textContent = 'From: ' + from; doc.appendChild(s); }
    for (const para of String(text).replace(/\r/g, '').split(/\n\s*\n|\n/)) {
      if (!para.trim()) continue;
      const p = document.createElement('p'); p.textContent = para.trim(); doc.appendChild(p);
    }
    document.title = (title || 'Untitled') + ' – Read Aloud Pro';
    window.scrollTo(0, 0);
    if (linked || __rap.scanState.hits || __rap.settings().autoScan) __rap.scan();   // your name and word groups, also coloured in the original
    if (autoRead) __rap.readPage();
  }
  window.rapBridge.onLoadText(show);

  document.getElementById('pasteText').onclick = async () => {
    const t = await navigator.clipboard.readText().catch(() => '');
    t.trim() ? show({ title: 'Pasted text', text: t, autoRead: true }) : status('The clipboard has no text.');
  };
  // Read screen: let the person choose which screen or window to read.
  document.getElementById('readScreen').onclick = async () => {
    status('Looking for your screens and windows…');
    const r = await window.rapBridge.send({ type: 'list-screens' }); status('');
    const list = r?.sources || [];
    if (!list.length) return status('Could not see any screens or windows to read.');
    const d = document.createElement('dialog'); d.className = 'picker';
    const h = document.createElement('h3'); h.textContent = 'Which screen or window should I read?'; d.appendChild(h);
    for (const kind of ['screen', 'window']) {
      const items = list.filter(s => s.kind === kind).sort((a, b) => kind === 'screen' ? (b.name.startsWith('Main') - a.name.startsWith('Main')) : 0); if (!items.length) continue;
      const sub = document.createElement('div'); sub.className = 'pk-h'; sub.textContent = kind === 'screen' ? 'Whole screens' : 'Single windows (read even if covered)'; d.appendChild(sub);
      const grid = document.createElement('div'); grid.className = 'pk-grid'; d.appendChild(grid);
      for (const s of items) {
        const b = document.createElement('button'); b.className = 'pk';
        const img = document.createElement('img'); img.src = s.thumb; img.alt = '';
        const cap = document.createElement('span'); cap.textContent = s.name;
        b.append(img, cap);
        b.onclick = () => { d.close(); d.remove(); status('Reading ' + s.name + '…'); window.rapBridge.send({ type: 'read-screen', id: s.id, name: s.name }); };
        grid.appendChild(b);
      }
    }
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.className = 'pk-cancel'; cancel.onclick = () => { d.close(); d.remove(); };
    d.appendChild(cancel); d.oncancel = () => d.remove();
    document.body.appendChild(d); d.showModal();
  };
  document.getElementById('openFile').onclick = async () => {
    const f = await window.rapBridge.send({ type: 'open-file' });
    if (!f || f.canceled) return;
    if (f.error) return status('Could not open: ' + f.error);
    try {
      const bytes = Uint8Array.from(atob(f.base64), c => c.charCodeAt(0));
      const title = f.name.replace(/\.[^.]+$/, '');
      let text;
      if (f.ext === 'docx') text = await RAP_docxText(bytes.buffer);
      else if (f.ext === 'pdf') text = f.text ?? (await window.rapBridge.send({ type: 'pdf-text', base64: f.base64 })).text;
      else if (f.ext === 'html' || f.ext === 'htm') text = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'text/html').body.innerText;
      else if (f.ext === 'eml') text = emlText(new TextDecoder().decode(bytes));
      else text = new TextDecoder().decode(bytes);
      if (!text || !text.trim()) return status('No readable text found in ' + f.name + '. For a scanned PDF, open it and use Read screen.');
      show({ title, text: text.replace(/^#+\s*/gm, ''), from: f.name, autoRead: false });
      status('Opened ' + f.name + '. Press Read page in the panel, or Alt+click a word to start there.');
    } catch (e) { status('Could not read ' + f.name + ': ' + e.message); }
  };
  // Very small .eml reader: subject plus the plain-text (or HTML) body.
  function emlText(raw) {
    const subj = (raw.match(/^Subject:\s*(.*)$/mi) || [])[1] || '';
    const body = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n');
    const html = /<html|<body|<p[ >]/i.test(body) ? new DOMParser().parseFromString(body, 'text/html').body.innerText : body;
    return (subj ? subj + '\n\n' : '') + html;
  }
  window.rapStatus = status;
  window.rapBridge.onStatus(status);
  if (!document.querySelector('[data-rap-ui]')) __rap.togglePanel();      // the panel is always docked on the right
  __rap.setTab('read');                                                   // also starts the first-run walkthrough
})();
