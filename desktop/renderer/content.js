// Read Aloud Pro: content script (runs on each page).
//
// Why the highlight stays in step here (the usual bug in simple readers):
//  1. Text is read ONE SENTENCE AT A TIME. Long utterances drift and some voices stop after ~15 s.
//  2. The word highlight follows the voice's own word events when the voice sends them.
//  3. Many voices (most Google / online voices) send no word events. Then the position is
//     ESTIMATED from elapsed time, using a speaking speed learned from that voice's own
//     previous sentences. The estimate resets at every sentence, so it can never drift far.
//  4. Pause = stop and remember the exact word; resume restarts from that word. (Chrome's
//     built-in pause/resume is broken for online voices.)
//  5. Highlights use the CSS Highlight API, so the page's HTML is never changed.
(() => {
  if (window.__rapLoaded) return;
  window.__rapLoaded = true;

  let ui = null, host = null;             // the floating panel (built on first use)
  let S = self.RAP_mergeSettings({});     // live settings
  let voiceInfo = {};                     // voiceURI -> { wordEvents: bool, cps: number }
  let collection = [];                    // sources gathered for Claude
  const ready = (async () => {
    S = await self.RAP_getSettings();
    const l = await chrome.storage.local.get({ voiceInfo: {}, collection: [] });
    voiceInfo = l.voiceInfo || {}; collection = l.collection || [];
    applyCatStyles();
  })();
  const save = patch => { Object.assign(S, patch); return self.RAP_setSettings(patch); };

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.settings) {
      const before = JSON.stringify([S.activeProfile, S.profiles, S.autoScan]);
      S = self.RAP_mergeSettings(ch.settings.newValue);
      applyCatStyles();
      if (ui) { syncControls(); renderFind(); renderAI(); fillVoices(); }
      if (before !== JSON.stringify([S.activeProfile, S.profiles, S.autoScan])) {
        if (scanState.hits) scan();
        setupAutoScan();
      }
    }
    if (ch.collection) { collection = ch.collection.newValue || []; if (ui) renderAI(); }
    if (ch.kbIndex && ui) renderAI();
  });

  const hasHL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  function setHL(name, ranges, priority = 0) {
    if (!hasHL) return;
    if (!ranges || !ranges.length) { CSS.highlights.delete(name); return; }
    const h = new Highlight(...ranges); h.priority = priority; CSS.highlights.set(name, h);
  }

  // ---------------------------------------------------------------- text model
  const SKIP = 'script,style,noscript,template,svg,canvas,textarea,select,option,input,iframe,[aria-hidden="true"],[data-rap-ui]';
  const visCache = new WeakMap();
  const blockCache = new WeakMap();
  function visible(el) {
    let v = visCache.get(el);
    if (v === undefined) {
      v = el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0;
      visCache.set(el, v);
    }
    return v;
  }
  function blockOf(el, root) {
    let e = el;
    while (e && e !== root) {
      let b = blockCache.get(e);
      if (b === undefined) {
        const d = getComputedStyle(e).display;
        b = !(d.startsWith('inline') || d === 'contents');
        blockCache.set(e, b);
      }
      if (b) return e;
      e = e.parentElement;
    }
    return root;
  }
  function brBetween(a, b) {
    if (a.nextSibling === b) return false;
    try { const r = document.createRange(); r.setStartAfter(a); r.setEndBefore(b); return !!r.cloneContents().querySelector('br,hr,img'); }
    catch { return false; }
  }

  // Builds { flat, segs, headings } from text nodes under root (optionally limited to a Range).
  function buildModel(root, range) {
    const segs = [], headings = [];
    let flat = '', prev = null, prevBlock = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        if (range && !range.intersectsNode(n)) return NodeFilter.FILTER_REJECT;
        if (!visible(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let a = 0, b = n.nodeValue.length;
      if (range) {
        if (n === range.startContainer) a = range.startOffset;
        if (n === range.endContainer) b = range.endOffset;
        if (b <= a) continue;
      }
      const blk = blockOf(n.parentElement, root);
      if (prev && (blk !== prevBlock || brBetween(prev, n))) flat += '\n';
      if (blk !== prevBlock && (/^H[1-6]$/.test(blk.tagName) || blk.getAttribute?.('role') === 'heading')) {
        headings.push({ pos: flat.length, text: blk.textContent.trim().replace(/\s+/g, ' ').slice(0, 70) });
      }
      segs.push({ node: n, a, b, f: flat.length });
      flat += n.nodeValue.slice(a, b);
      prev = n; prevBlock = blk;
    }
    return { flat, segs, headings, nodeIndex: new Map(segs.map((s, i) => [s.node, i])) };
  }
  function modelFromString(str) { return { flat: str, segs: [], headings: [], nodeIndex: new Map() }; }

  function point(m, pos, preferEnd) {
    const segs = m.segs; if (!segs.length) return null;
    let lo = 0, hi = segs.length - 1, i = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid].f <= pos) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    if (i < 0) return { node: segs[0].node, off: segs[0].a };
    const s = segs[i], len = s.b - s.a;
    if (pos - s.f < len || (preferEnd && pos - s.f === len)) return { node: s.node, off: s.a + (pos - s.f) };
    if (preferEnd) return { node: s.node, off: s.b };
    const nx = segs[i + 1]; return nx ? { node: nx.node, off: nx.a } : { node: s.node, off: s.b };
  }
  function rangeFor(m, s, e) {
    const a = point(m, s, false), b = point(m, e, true); if (!a || !b) return null;
    try { const r = document.createRange(); r.setStart(a.node, a.off); r.setEnd(b.node, b.off); return r; } catch { return null; }
  }
  function posOf(m, node, off) {
    let i = m.nodeIndex.get(node);
    if (i !== undefined) { const s = m.segs[i]; return s.f + Math.max(0, Math.min(off, s.b) - s.a); }
    for (const s of m.segs) {                       // element or skipped node: first segment at/after it
      if (node.contains?.(s.node) || (node.compareDocumentPosition(s.node) & Node.DOCUMENT_POSITION_FOLLOWING)) return s.f;
    }
    return 0;
  }

  const sentSeg = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  const wordSeg = new Intl.Segmenter(undefined, { granularity: 'word' });
  function sentencesOf(flat) {
    const out = [];
    const push = (s, e) => {
      while (s < e && /\s/.test(flat[s])) s++;
      while (e > s && /\s/.test(flat[e - 1])) e--;
      if (e > s && /[\p{L}\p{N}]/u.test(flat.slice(s, e))) out.push({ s, e });
    };
    const lineRe = /[^\n]+/g; let lm;
    while ((lm = lineRe.exec(flat))) {
      for (const seg of sentSeg.segment(lm[0])) {
        let s = lm.index + seg.index, e = s + seg.segment.length;
        while (e - s > 240) {                       // split very long sentences at a comma or space
          const chunk = flat.slice(s, s + 240);
          let cut = Math.max(chunk.lastIndexOf(', '), chunk.lastIndexOf('; '), chunk.lastIndexOf(': '));
          if (cut < 80) cut = chunk.lastIndexOf(' ');
          if (cut < 40) cut = 240; else cut += 1;
          push(s, s + cut); s += cut;
        }
        push(s, e);
      }
    }
    return out;
  }
  function wordsOf(flat, sen) {
    const w = [];
    for (const seg of wordSeg.segment(flat.slice(sen.s, sen.e))) if (seg.isWordLike) w.push({ s: sen.s + seg.index, e: sen.s + seg.index + seg.segment.length });
    return w;
  }

  // ---------------------------------------------------------------- reader
  const R = { m: null, sents: [], idx: 0, pos: 0, playing: false, token: 0, timer: null, words: [], label: '' };
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() { voices = synth.getVoices(); if (ui) fillVoices(); }
  if (synth) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }
  function currentVoice() {
    return voices.find(v => v.voiceURI === S.voiceURI) || voices.find(v => v.default) || voices[0] || null;
  }

  function startReading(m, startPos = 0, label = '') {
    stopReading(true);
    R.m = m; R.sents = sentencesOf(m.flat); R.label = label;
    if (!R.sents.length) { toast('Nothing readable found here.'); return; }
    let i = R.sents.findIndex(s => s.e > startPos); if (i < 0) i = 0;
    R.playing = true;
    if (label !== 'answer') R.last = { m, pos: R.sents[i].s, label };     // what "read that again" refers to
    showPanel(); if (label !== 'answer') setTab('read');
    speakSentence(i, Math.max(startPos, R.sents[i].s));
  }

  function speakSentence(i, fromPos) {
    stopTimer();
    const tok = ++R.token;
    const sen = R.sents[i];
    if (!sen) { finishReading(); return; }
    R.idx = i;
    const words = wordsOf(R.m.flat, sen);
    let wi = Math.max(0, words.findIndex(w => w.e > fromPos));
    const base = words[wi] ? Math.min(words[wi].s, Math.max(fromPos, sen.s)) : sen.s;
    R.words = words; R.pos = base;
    const text = R.m.flat.slice(base, sen.e);
    setHL('rap-sentence', [rangeFor(R.m, sen.s, sen.e)].filter(Boolean), 1);
    markWord(base);
    updateStatus();
    if (S.engine === 'elevenlabs' || S.engine === 'kokoro') return speakEleven(i, sen, base, text, tok);

    const v = currentVoice();
    const u = new SpeechSynthesisUtterance(text);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = +S.rate || 1;
    const key = v ? v.voiceURI : 'default';
    const info = voiceInfo[key] || (voiceInfo[key] = { wordEvents: null, cps: 14 });
    let gotWord = false, t0 = 0;

    u.onstart = () => {
      if (tok !== R.token) return;
      t0 = performance.now();
      R.timer = setInterval(() => {               // estimator; stopped as soon as real word events arrive
        if (gotWord || tok !== R.token) return;
        const est = base + ((performance.now() - t0) / 1000) * info.cps * u.rate;
        markWord(Math.min(est, sen.e - 1));
      }, 80);
    };
    u.onboundary = e => {
      if (tok !== R.token || (e.name && e.name !== 'word')) return;
      gotWord = true; stopTimer();
      markWord(base + e.charIndex);
    };
    u.onend = () => {
      if (tok !== R.token) return;
      stopTimer();
      const dt = (performance.now() - t0) / 1000;
      if (t0 && dt > 0.6 && text.length > 15) {    // learn this voice's real speed (chars per second at rate 1)
        const cps = text.length / dt / u.rate;
        if (cps > 4 && cps < 40) info.cps = info.cps * 0.6 + cps * 0.4;
      }
      if (info.wordEvents !== gotWord) { info.wordEvents = gotWord; if (ui) fillVoices(); }
      chrome.storage.local.set({ voiceInfo });
      if (R.playing) speakSentence(i + 1, R.sents[i + 1]?.s ?? 0);
    };
    u.onerror = e => {
      if (tok !== R.token || e.error === 'interrupted' || e.error === 'canceled') return;
      stopTimer();
      toast(e.error === 'not-allowed'
        ? 'The browser needs one click on this page before it can speak. Click anywhere on the page, then try again.'
        : 'Voice error: ' + e.error + '. Try another voice.');
      R.playing = false; updateStatus();
    };
    synth.cancel();
    setTimeout(() => { if (tok === R.token && R.playing) synth.speak(u); }, 60);  // Chrome can drop a speak() issued right after cancel()
  }

  // ---- ElevenLabs voice (optional): real audio file per sentence, so the speaker can be chosen and
  // the highlight follows ElevenLabs' own per-character timings.
  let elAudio = null; const elCache = new Map();
  // Kokoro (free voice on this PC, desktop app) and ElevenLabs share this audio-file path.
  function elFetch(text) {
    const kok = S.engine === 'kokoro';
    const k = (kok ? 'k:' + S.kokoroVoice : S.elVoice) + '|' + text;
    if (!elCache.has(k)) {
      elCache.set(k, chrome.runtime.sendMessage(kok ? { type: 'tts-kokoro', text } : { type: 'tts11', text }).then(r => { if (!r || r.error) throw new Error(r?.error || 'no reply'); return r; }));
      if (elCache.size > 40) elCache.delete(elCache.keys().next().value);
    }
    return elCache.get(k);
  }
  function stopAudio() { if (elAudio) { elAudio.onended = elAudio.onerror = null; elAudio.pause(); elAudio = null; } }
  async function applySink(a) {
    if (!S.speakerLabel || !a.setSinkId) return;
    try {
      const outs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
      const d = outs.find(o => o.label === S.speakerLabel);
      if (d) await a.setSinkId(d.deviceId);
      else if (!applySink.warned) { applySink.warned = true; toast('Chosen speaker not found here; using the default. Allow the microphone once on this site so speakers can be matched.'); }
    } catch {}
  }
  async function speakEleven(i, sen, base, text, tok) {
    let r;
    try { r = await elFetch(text); }
    catch (e) { if (tok !== R.token) return; elCache.clear(); toast((S.engine === 'kokoro' ? 'Voice: ' : 'ElevenLabs: ') + e.message); R.playing = false; updateStatus(); return; }
    if (tok !== R.token || !R.playing) return;
    const nx = R.sents[i + 1]; if (nx) elFetch(R.m.flat.slice(nx.s, nx.e)).catch(() => {});   // fetch the next sentence early
    stopAudio();
    const a = new Audio((S.engine === 'kokoro' ? 'data:audio/wav;base64,' : 'data:audio/mpeg;base64,') + r.audio); elAudio = a;
    a.playbackRate = Math.min(2, +S.rate || 1); a.preservesPitch = true;
    await applySink(a);
    const starts = r.starts || [];
    R.timer = setInterval(() => {
      if (tok !== R.token) return;
      const t = a.currentTime; let k = 0;
      while (k + 1 < starts.length && starts[k + 1] <= t) k++;
      markWord(base + k);
    }, 60);
    a.onended = () => { if (tok !== R.token) return; stopTimer(); if (R.playing) speakSentence(i + 1, R.sents[i + 1]?.s ?? 0); };
    a.onerror = () => { if (tok !== R.token) return; stopTimer(); toast('Could not play the ElevenLabs audio.'); R.playing = false; updateStatus(); };
    a.play().catch(e => { toast('Audio blocked: click the page once, then try again.'); R.playing = false; updateStatus(); });
  }

  function markWord(pos) {
    const w = R.words.find(x => x.e > pos) || R.words[R.words.length - 1];
    if (!w) return;
    R.pos = w.s;
    if (R.label !== 'answer' && R.last && R.last.m === R.m) R.last.pos = w.s;
    const r = rangeFor(R.m, w.s, w.e);
    setHL('rap-word', r ? [r] : [], 3);
    if (r && S.followScroll) keepInView(r);
  }
  let lastScroll = 0;
  function keepInView(r) {
    const now = performance.now(); if (now - lastScroll < 400) return;
    const b = r.getBoundingClientRect(); if (!b.height) return;
    if (b.top < 60 || b.bottom > innerHeight - 60) {
      lastScroll = now;
      (r.startContainer.parentElement || document.body).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  function stopTimer() { if (R.timer) { clearInterval(R.timer); R.timer = null; } }
  function pauseReading() { if (!R.m) return; R.playing = false; R.token++; stopTimer(); synth.cancel(); stopAudio(); updateStatus(); }
  function resumeReading() {
    if (!R.m) return;
    R.playing = true;
    let i = R.sents.findIndex(s => s.e > R.pos); if (i < 0) i = R.idx;
    speakSentence(i, R.pos);
  }
  function togglePause() { if (!R.m) return readSelectionOrPage(); R.playing ? pauseReading() : resumeReading(); }
  function skip(d) { if (!R.m) return; R.playing = true; const i = Math.max(0, Math.min(R.sents.length - 1, R.idx + d)); speakSentence(i, R.sents[i].s); }
  function stopReading(silent) {
    R.playing = false; R.token++; stopTimer(); synth && synth.cancel(); stopAudio();
    setHL('rap-word', []); setHL('rap-sentence', []);
    if (!silent) { R.m = null; updateStatus(); }
  }
  function finishReading() { R.playing = false; setHL('rap-word', []); setHL('rap-sentence', []); R.m = null; updateStatus(); }
  function restartAtCurrent() { if (R.m && R.playing) { const i = R.sents.findIndex(s => s.e > R.pos); speakSentence(i < 0 ? R.idx : i, R.pos); } }

  function selectionModel() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    let root = range.commonAncestorContainer; if (root.nodeType !== 1) root = root.parentElement;
    let m = buildModel(root, range);
    if (!m.flat.trim()) { const t = sel.toString(); if (!t.trim()) return null; m = modelFromString(t); }
    sel.removeAllRanges();
    return m;
  }
  function pageRoot() {
    if (window.RAP_DESKTOP) return document.getElementById('doc');
    const c = document.querySelector('main, [role="main"], article');
    return c && c.innerText && c.innerText.length > 400 ? c : document.body;
  }
  function readSelection() { const m = selectionModel(); if (!m) { toast('Highlight some text first, or use Read page.'); return; } startReading(m, 0, 'selection'); }
  function readPage() { startReading(buildModel(pageRoot()), 0, 'page'); }
  function readSelectionOrPage() { const m = selectionModel(); m ? startReading(m, 0, 'selection') : readPage(); }
  function readFromNode(node, off) {
    let root = pageRoot(); if (!root.contains(node)) root = document.body;
    const m = buildModel(root); startReading(m, posOf(m, node, off), 'page');
  }
  function caretAt(x, y) {
    if (document.caretPositionFromPoint) { const c = document.caretPositionFromPoint(x, y); if (c) return { node: c.offsetNode, off: c.offset }; }
    if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) return { node: r.startContainer, off: r.startOffset }; }
    return null;
  }
  document.addEventListener('click', e => {
    if (!e.altKey || e.shiftKey || e.ctrlKey || !S.clickToRead) return;
    if (e.composedPath().some(n => n.dataset?.rapUi !== undefined)) return;
    const c = caretAt(e.clientX, e.clientY); if (!c) return;
    e.preventDefault(); e.stopPropagation();
    readFromNode(c.node, c.off);
  }, true);
  let lastContext = null;
  document.addEventListener('contextmenu', e => { lastContext = caretAt(e.clientX, e.clientY); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && R.m) stopReading(); }, true);
  addEventListener('pagehide', () => synth && synth.cancel());

  // ---------------------------------------------------------------- finder
  // Word groups come from the active profile (Settings → Highlighting). Each has its own colour.
  const profile = () => S.profiles[S.activeProfile] || Object.values(S.profiles)[0];
  const cats = () => (profile()?.categories || []).filter(c => c.enabled !== false);
  const hlName = c => 'rap-c-' + String(c.id).replace(/[^\w-]/g, '');
  function applyCatStyles() {
    let st = document.getElementById('rap-cat-style');
    if (!st) { st = document.createElement('style'); st.id = 'rap-cat-style'; (document.head || document.documentElement).appendChild(st); }
    const all = Object.values(S.profiles).flatMap(p => p.categories || []);
    st.textContent = all.map(c => {
      const hex = /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#ffcc00';
      return `::highlight(${hlName(c)}){background-color:${hex}66}`;
    }).join('\n');
  }
  function clearCatHighlights() { if (hasHL) for (const k of [...CSS.highlights.keys()]) if (k.startsWith('rap-c-')) CSS.highlights.delete(k); }
  const scanState = { hits: null, cursor: {}, open: null, when: null };
  function termRegex(list) {
    const terms = String(list || '').split(/[,\n;]/).map(t => t.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!terms.length) return null;
    const pat = terms.map(t => {
      const body = t.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s\\u00a0-]+')).join('[\\p{L}\\p{N}]*');
      return /[\p{L}]$/u.test(t) ? body + "(?:e?s|'s)?" : body;     // plurals and possessives: no shows, Sam's
    }).join('|');
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pat})(?![\\p{L}\\p{N}])`, 'giu');
  }
  function scan() {
    const m = buildModel(document.body);
    const hits = {};
    clearCatHighlights();
    for (const c of cats()) {
      hits[c.id] = [];
      const re = termRegex(c.terms); if (!re) continue;
      let mt;
      while ((mt = re.exec(m.flat))) {
        if (!mt[0]) { re.lastIndex++; continue; }
        const r = rangeFor(m, mt.index, mt.index + mt[0].length); if (!r) continue;
        const a = Math.max(0, mt.index - 50), b = Math.min(m.flat.length, mt.index + mt[0].length + 50);
        let h = null; for (const hd of m.headings) { if (hd.pos <= mt.index) h = hd; else break; }
        hits[c.id].push({
          range: r, term: mt[0], pos: mt.index,
          before: (a > 0 ? '…' : '') + m.flat.slice(a, mt.index).replace(/\s+/g, ' '),
          after: m.flat.slice(mt.index + mt[0].length, b).replace(/\s+/g, ' ') + (b < m.flat.length ? '…' : ''),
          heading: h ? h.text : ''
        });
      }
      setHL(hlName(c), hits[c.id].map(x => x.range), 0);
    }
    scanState.hits = hits; scanState.cursor = {}; scanState.when = new Date();
    const total = Object.values(hits).reduce((n, l) => n + l.length, 0);
    chrome.runtime.sendMessage({ type: 'badge', text: total ? String(total) : '' }).catch(() => {});
    if (ui) renderFind();
    return hits;
  }
  function clearScan() { clearCatHighlights(); scanState.hits = null; chrome.runtime.sendMessage({ type: 'badge', text: '' }).catch(() => {}); if (ui) renderFind(); }
  function jumpTo(hit) {
    (hit.range.startContainer.parentElement || document.body).scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHL('rap-flash', [hit.range], 5);
    clearTimeout(jumpTo.t); jumpTo.t = setTimeout(() => setHL('rap-flash', []), 1800);
  }
  function step(catId, d) {
    const list = scanState.hits?.[catId]; if (!list?.length) return;
    let i = scanState.cursor[catId]; i = i === undefined ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length;
    scanState.cursor[catId] = i; jumpTo(list[i]); renderFind();
  }
  let autoObs = null, autoT = null;
  function setupAutoScan() {
    if (autoObs) { autoObs.disconnect(); autoObs = null; }
    if (!S.autoScan) return;
    setTimeout(scan, 1200);
    autoObs = new MutationObserver(() => { clearTimeout(autoT); autoT = setTimeout(scan, 2000); });
    autoObs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  ready.then(setupAutoScan);

  // ---------------------------------------------------------------- panel UI
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function buildUI() {
    host = document.createElement('div');
    host.dataset.rapUi = '';
    host.style.cssText = window.RAP_DESKTOP ? 'position:fixed;right:0;top:0;bottom:0;z-index:2147483647;' : 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  :host{all:initial}
  *{box-sizing:border-box;font-family:Segoe UI,system-ui,sans-serif}
  .p{width:340px;background:#1d1f24;color:#eceef2;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:13px;overflow:hidden}
  .hd{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#26292f;cursor:move;user-select:none}
  .hd b{flex:1;font-size:13px}
  .x{background:none;border:0;color:#aab;font-size:16px;cursor:pointer}
  .tabs{display:flex;border-bottom:1px solid #333}
  .tabs button{flex:1;background:none;border:0;color:#aab;padding:7px;cursor:pointer;font-size:12px;border-bottom:2px solid transparent}
  .tabs button.on{color:#fff;border-bottom-color:#ffd400}
  .bd{padding:10px;max-height:60vh;overflow:auto}
  ${window.RAP_DESKTOP ? '.p{width:380px;height:100vh;border-radius:0;box-shadow:none;display:flex;flex-direction:column}.bd{max-height:none;flex:1}.hd{cursor:default}#close{display:none}' : ''}
  .row{display:flex;gap:6px;align-items:center;margin:6px 0}
  .btn{background:#33363d;border:1px solid #444;color:#eee;border-radius:7px;padding:6px 9px;cursor:pointer;font-size:12px}
  .btn:hover{background:#3d4048}
  .btn.pri{background:#ffd400;color:#111;border-color:#ffd400;font-weight:600}
  .btn:disabled{opacity:.45;cursor:default}
  .ic{width:34px;font-size:14px;padding:5px 0}
  select,input[type=range],textarea{width:100%}
  select,textarea{background:#2a2d33;color:#eee;border:1px solid #444;border-radius:6px;padding:5px;font-size:12px}
  textarea{resize:vertical;min-height:44px}
  .mut{color:#99a;font-size:11px}
  .st{font-size:12px;color:#cfd3da;min-height:16px}
  .cat{border:1px solid #33363d;border-radius:8px;margin:6px 0;overflow:hidden}
  .ch{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer}
  .dot{width:10px;height:10px;border-radius:50%}
  .ch .n{margin-left:auto;font-weight:700}
  .hit{padding:6px 8px;border-top:1px solid #2c2f35;cursor:pointer;font-size:12px;line-height:1.35}
  .hit:hover{background:#2a2d33}
  .hit.cur{background:#30343c}
  .hit .w{font-size:11px;color:#99a;margin-top:2px}
  .hit mark{background:transparent;color:#fff;font-weight:700;text-decoration:underline}
  .out{white-space:pre-wrap;background:#25282e;border:1px solid #3a3d44;border-radius:8px;padding:8px;font-size:12.5px;line-height:1.45;min-height:40px}
  .toast{position:absolute;left:10px;right:10px;bottom:10px;background:#000c;color:#fff;padding:7px 9px;border-radius:7px;font-size:12px;display:none}
  ::highlight(rap-sentence){background-color:rgba(255,221,0,.22)}
  ::highlight(rap-word){background-color:#ffd400;color:#000}
  label{display:flex;gap:6px;align-items:center}
  .row.wrap{flex-wrap:wrap}
  input[type=text]{flex:1;background:#2a2d33;color:#eee;border:1px solid #444;border-radius:6px;padding:5px;font-size:12px;min-width:0}
  .sec{font-weight:600;margin:4px 0 2px}
  .src{display:flex;gap:6px;align-items:center;padding:4px 6px;border:1px solid #33363d;border-radius:6px;margin:3px 0;font-size:12px}
  .src .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .src .k{color:#99a;font-size:11px;white-space:nowrap}
</style>
<div class="p" style="position:relative">
  <div class="hd" id="drag"><b>🔊 Read Aloud Pro</b><button class="x" id="mic" title="${window.RAP_DESKTOP ? 'Push-to-talk (Ctrl+Alt+V unless you changed it): click, then say a command. Say “help” to hear them all.' : 'Voice commands on/off (Alt+Shift+V). Say “help” to hear the commands.'}">🎤</button>${window.RAP_DESKTOP ? '<button class="x" id="help" title="Manual: how to use everything">?</button>' : ''}<button class="x" id="set" title="Settings">⚙</button><button class="x" id="close" title="Hide">✕</button></div>
  <div id="heard" class="mut" style="padding:5px 10px;background:#2b2440;display:none"></div>
  <div class="tabs"><button data-t="read" class="on">Read</button><button data-t="find">Find</button><button data-t="ai">Claude</button></div>
  <div class="bd" id="t-read">
    <div class="row"><button class="btn pri" id="rsel">Read highlighted</button><button class="btn" id="rpage">Read page</button></div>
    <div class="row">
      <button class="btn ic" id="prev" title="Previous sentence">⏮</button>
      <button class="btn ic" id="play" title="Pause / resume (${window.RAP_DESKTOP ? 'Ctrl+Alt+Space' : 'Alt+Shift+Space'})">⏯</button>
      <button class="btn ic" id="next" title="Next sentence">⏭</button>
      <button class="btn ic" id="stop" title="Stop (Esc)">⏹</button>
      <span class="st" id="status"></span>
    </div>
    <div class="row"><select id="voice"></select></div>
    <div class="row"><span style="width:52px">Speed</span><input type="range" id="rate" min="0.5" max="3" step="0.1"><span id="rateV" style="width:34px;text-align:right"></span></div>
    <div class="row"><label><input type="checkbox" id="follow"> Scroll to follow along</label></div>
    <div class="mut">Alt+click any word on the page to start reading from there. ✓ = voice reports each word (exact highlight). ≈ = highlight is timed by estimate.</div>
  </div>
  <div class="bd" id="t-find" hidden>
    <div class="row"><select id="prof" title="Profile: a saved set of word groups"></select><button class="btn" id="editprof" title="Add word groups, change terms and colours">Edit groups</button></div>
    <div class="row"><span style="white-space:nowrap">Your name</span><input type="text" id="myname" placeholder="e.g. Sam Taylor, Taylor"></div>
    <div class="row"><button class="btn pri" id="scan">Scan this page</button><button class="btn" id="clear">Clear</button><span class="mut" id="when"></span></div>
    <div id="cats"></div>
  </div>
  <div class="bd" id="t-ai" hidden>
    <div id="aioff" hidden>
      <div class="out">Claude is off. In Settings, connect it with your Claude Code login on this computer, or with an API key. You can still collect sources below.</div>
      <div class="row">${window.RAP_DESKTOP ? '<button class="btn pri" id="useCode">Turn on: use my Claude Code login</button>' : ''}<button class="btn" id="openset">Open Settings</button></div>
      <div class="out" id="useCodeMsg" hidden></div>
    </div>
    <div class="sec">Memory <span class="mut" id="srcinfo"></span></div>
    <div id="srclist"></div>
    <div class="row wrap">
      <button class="btn" id="addsel" title="Add the text you highlighted on this page">+ Highlighted</button>
      <button class="btn" id="addpage" title="Add this whole page or email">+ This page</button>
      <button class="btn" id="addpaste" title="Paste text from anywhere (Google Docs, PDFs, Teams)">+ Paste</button>
      <button class="btn" id="clrsrc">Clear all</button>
    </div>
    <div id="pastebox" hidden>
      <textarea id="pastetitle" style="min-height:28px" placeholder="Title (optional)"></textarea>
      <textarea id="pastetxt" placeholder="Paste the text here"></textarea>
      <div class="row"><button class="btn" id="pasteok">Add source</button><button class="btn" id="pastecancel">Cancel</button></div>
    </div>
    <div class="mut" id="kbinfo" style="margin:6px 0"></div>
    <div class="row" id="vaultrow" hidden><span style="white-space:nowrap">Notes from Obsidian</span><select id="vaultSel" title="Claude also looks for related notes in this vault when it writes, researches or answers. Summaries never use it."></select></div>
    <div id="aion">
      <div class="row">
        <button class="btn pri" data-task="write">Write</button>
        <select id="fmt" title="What to write">
          <option value="auto">Auto (asks if unclear)</option><option value="outlook">Outlook email</option>
          <option value="word">Word document</option><option value="teams">Teams message</option><option value="slack">Slack message</option>
        </select>
      </div>
      <div class="row wrap">
        <button class="btn" data-task="summarize">Summarize</button>
        <button class="btn" data-task="connect" title="Find links, patterns, gaps and contradictions across the sources">Connect the dots</button>
        <button class="btn" data-task="issues">List issues</button>
        <button class="btn" data-task="research" title="Highlight what you don't understand, then click. Claude explains it using your documents, notes and the web.">Research</button>
      </div>
      <textarea id="extra" placeholder="What do you want? e.g. 'Reply to Mike with the 3 safety items and next steps, short'"></textarea>
    </div>
    <div class="row"><span class="mut" id="aistat"></span></div>
    <div class="row" id="aitop" hidden><button class="btn pri" id="speak">▶ Read aloud</button><button class="btn" id="stopsp">■ Stop</button></div>
    <div class="out" id="aiout" hidden></div>
    <div class="row wrap" id="aiq" hidden></div>
    <div class="row wrap" id="aiacts" hidden>
      <button class="btn pri" id="openOut" hidden>Open in Outlook</button><button class="btn pri" id="openWord" hidden>Open in Word</button>
      <button class="btn" id="copy">Copy</button><button class="btn" id="save">Save</button>
    </div>
    <div class="row"><a id="savesel" class="mut" style="cursor:pointer;text-decoration:underline">Save highlighted text as a note</a></div>
  </div>
  <div class="toast" id="toast"></div>
</div>`;
    document.documentElement.appendChild(host);
    const $ = id => root.getElementById(id);
    ui = { root, $ };

    root.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));
    $('close').onclick = () => { host.style.display = 'none'; };
    $('mic').onclick = toggleVoice;
    $('set').onclick = $('openset').onclick = () => chrome.runtime.sendMessage({ type: 'openOptions' });
    $('help')?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-manual' }));
    $('useCode')?.addEventListener('click', async () => {        // J switches Claude on here; nothing runs until he clicks
      const m = $('useCodeMsg'); m.hidden = false; m.textContent = 'Checking your Claude Code login… (10 to 30 seconds)';
      const r = await chrome.runtime.sendMessage({ type: 'claude', mode: 'code', task: 'ping', sources: [] }).catch(e => ({ error: String(e) }));
      if (r?.error) { m.textContent = '✗ ' + r.error; return; }
      S = await self.RAP_setSettings({ claudeMode: 'code' }); m.hidden = true; renderAI(); setTab('ai'); toast('Claude is on. Collect sources, then Summarize or Write.'); setTimeout(() => self.RAP_maybeTour?.('aiOn', { root: ui.root, avoid: ui.root.host, openManual: s => chrome.runtime.sendMessage({ type: 'open-manual', section: s }) }), 600);
    });
    $('rsel').onmousedown = e => e.preventDefault();            // keep the page selection when clicking
    $('rsel').onclick = () => { if (window.RAP_DESKTOP && !String(getSelection()).trim()) chrome.runtime.sendMessage({ type: 'read-from-app' }); else readSelection(); };   // desktop: nothing highlighted here, so fetch it from the program used just before
    $('rpage').onclick = readPage;
    $('play').onclick = togglePause;
    $('prev').onclick = () => skip(-1);
    $('next').onclick = () => skip(1);
    $('stop').onclick = () => stopReading();
    $('voice').onchange = e => {
      const v = e.target.value; if (v === '__el') return;
      const p = v.startsWith('k:') ? { engine: 'kokoro', kokoroVoice: v.slice(2) } : { voiceURI: v, engine: 'browser' };
      save(p).then(() => { fillVoices(); restartAtCurrent(); });
    };
    $('rate').oninput = e => { $('rateV').textContent = (+e.target.value).toFixed(1) + '×'; };
    $('rate').onchange = e => { save({ rate: +e.target.value }); restartAtCurrent(); };
    $('follow').onchange = e => save({ followScroll: e.target.checked });
    $('scan').onclick = scan;
    $('clear').onclick = clearScan;
    $('prof').onchange = e => { save({ activeProfile: e.target.value }).then(() => scanState.hits && scan()); };
    $('editprof').onclick = () => chrome.runtime.sendMessage({ type: 'openOptions', section: 'highlight' });
    $('myname').onchange = e => {
      const p = structuredClone(profile()); const c = p.categories.find(x => x.isName);
      if (c) c.terms = e.target.value.trim(); else p.categories.unshift({ id: 'name', label: 'Your name', color: '#9b59ff', enabled: true, isName: true, terms: e.target.value.trim() });
      save({ profiles: { ...S.profiles, [p.id]: p } }).then(() => scanState.hits && scan());
    };
    for (const id of ['addsel', 'addpage', 'addpaste']) $(id).onmousedown = e => e.preventDefault();   // keep the page selection
    $('addsel').onclick = () => {
      const t = getSelection().toString().trim();
      if (!t) { toast('Highlight some text on the page first.'); return; }
      addSource({ title: document.title, url: location.href, text: t, kind: 'highlighted' });
    };
    $('addpage').onclick = () => addSource({ title: document.title, url: location.href, text: buildModel(pageRoot()).flat, kind: 'page' });
    $('addpaste').onclick = () => { $('pastebox').hidden = false; $('pastetxt').focus(); };
    $('pastecancel').onclick = () => { $('pastebox').hidden = true; };
    $('pasteok').onclick = () => {
      const t = $('pastetxt').value.trim(); if (!t) return;
      addSource({ title: $('pastetitle').value.trim() || 'Pasted text', url: '', text: t, kind: 'pasted' });
      $('pastetxt').value = $('pastetitle').value = ''; $('pastebox').hidden = true;
    };
    $('clrsrc').onclick = () => { if (collection.length && confirm('Remove all ' + collection.length + ' sources?')) chrome.storage.local.set({ collection: [] }); };
    root.querySelectorAll('[data-task]').forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => runClaude(b.dataset.task); });
    $('copy').onclick = () => { navigator.clipboard.writeText(aiResult.text); toast('Copied.'); };
    // Summaries and research are already plain text, so the words light up in the panel as they are read.
    // Drafts are read without their Subject/To lines and symbols.
    $('speak').onclick = () => { if (aiResult.format) return speakText(aiResult.text); const m = buildModel($('aiout')); startReading(m.flat.trim() ? m : modelFromString(aiResult.text), 0, 'result'); };
    $('stopsp').onclick = () => stopReading();
    $('save').onclick = () => saveResult(false);
    $('openOut').onclick = () => saveResult(true);
    $('openWord').onclick = () => saveResult(true);
    $('fmt').onchange = e => save({ writeFormat: e.target.value });
    $('savesel').onmousedown = e => e.preventDefault();
    $('savesel').onclick = () => {
      const t = getSelection().toString().trim();
      if (!t) { toast('Highlight some text on the page first.'); return; }
      saveNote('Note', t);
    };

    // drag
    let dx, dy, drag = false;
    $('drag').addEventListener('mousedown', e => { if (e.target.closest('button')) return; drag = true; const r = host.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; e.preventDefault(); });
    addEventListener('mousemove', e => { if (!drag) return; host.style.left = Math.max(0, e.clientX - dx) + 'px'; host.style.top = Math.max(0, e.clientY - dy) + 'px'; host.style.right = host.style.bottom = 'auto'; });
    addEventListener('mouseup', () => drag = false);

    syncControls(); fillVoices(); renderFind(); updateStatus(); renderAI();
  }
  function showPanel() { if (!ui) buildUI(); host.style.display = ''; }
  function togglePanel() { if (!ui) return buildUI(); host.style.display = host.style.display === 'none' ? '' : 'none'; }
  function setTab(t) {
    if (!ui) return;
    ui.root.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    for (const id of ['read', 'find', 'ai']) ui.$('t-' + id).hidden = id !== t;
    if (t === 'ai') renderAI();
    // Desktop: the first time each tab is shown, a short walkthrough explains it.
    if (window.RAP_DESKTOP && self.RAP_maybeTour) {
      const o = { root: ui.root, avoid: ui.root.host, openManual: s => chrome.runtime.sendMessage({ type: 'open-manual', section: s }) };
      const claudeOn = () => S.claudeMode === 'code' || S.claudeMode === 'api';
      setTimeout(() => self.RAP_maybeTour(t, { ...o, then: t === 'ai' ? () => claudeOn() && self.RAP_maybeTour('aiOn', o) : null }), t === 'ai' ? 400 : 150);
    }
  }
  function syncControls() {
    if (!ui) return;
    ui.$('rate').value = S.rate; ui.$('rateV').textContent = (+S.rate).toFixed(1) + '×';
    ui.$('follow').checked = !!S.followScroll;
    ui.$('fmt').value = S.writeFormat || 'auto';
    ui.$('prof').innerHTML = Object.values(S.profiles).map(p => `<option value="${esc(p.id)}"${p.id === S.activeProfile ? ' selected' : ''}>Profile: ${esc(p.name)}</option>`).join('');
    const nm = profile()?.categories.find(c => c.isName);
    if (ui.root.activeElement !== ui.$('myname')) ui.$('myname').value = nm ? nm.terms : '';
  }
  function fillVoices() {
    if (!ui) return;
    const sel = ui.$('voice'); const cur = currentVoice();
    const lang = (navigator.language || 'en').slice(0, 2);
    const sorted = [...voices].sort((a, b) => (b.lang.startsWith(lang) - a.lang.startsWith(lang)) || a.name.localeCompare(b.name));
    sel.innerHTML = sorted.map(v => {
      const wi = voiceInfo[v.voiceURI]?.wordEvents;
      const mark = wi === true ? ' ✓' : wi === false ? ' ≈' : '';
      return `<option value="${esc(v.voiceURI)}"${cur && v.voiceURI === cur.voiceURI ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})${mark}</option>`;
    }).join('') || '<option>Loading voices…</option>';
    if (window.RAP_DESKTOP) {
      const kv = fillVoices.kokoro || [];
      const nice = v => `${v.name || v.id} (${/^b/.test(v.id) ? 'British' : 'American'} ${v.gender === 'Male' || /^.m_/.test(v.id) ? 'male' : 'female'})`;
      sel.innerHTML = `<optgroup label="Natural voices (free, on this PC)">${kv.length ? kv.map(v => `<option value="k:${esc(v.id)}"${S.engine === 'kokoro' && S.kokoroVoice === v.id ? ' selected' : ''}>${esc(nice(v))}</option>`).join('') : `<option value="k:${esc(S.kokoroVoice || 'af_heart')}" selected>Loading natural voices…</option>`}</optgroup>`
        + `<optgroup label="Windows voices (robotic)">${S.engine === 'kokoro' ? sel.innerHTML.replace(/ selected/g, '') : sel.innerHTML}</optgroup>`;
      if (!fillVoices.kokoro && !fillVoices.loading) {
        fillVoices.loading = true;
        chrome.runtime.sendMessage({ type: 'kokoro-voices' }).then(r => { fillVoices.loading = false; if (r?.voices) { fillVoices.kokoro = r.voices; fillVoices(); } });
      }
    }
    if (S.engine === 'elevenlabs') sel.innerHTML = `<option value="__el" selected>ElevenLabs: ${esc(S.elVoiceName || 'voice not chosen')}</option>` + sel.innerHTML;
  }
  function updateStatus() {
    if (!ui) return;
    const st = ui.$('status');
    if (!R.m) st.textContent = '';
    else st.textContent = `${R.playing ? 'Reading' : 'Paused'} · ${R.idx + 1} of ${R.sents.length}`;
  }
  function renderFind() {
    if (!ui) return;
    const box = ui.$('cats'), h = scanState.hits;
    ui.$('when').textContent = scanState.when ? 'Scanned ' + scanState.when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    if (!h) { box.innerHTML = '<div class="mut" style="margin:8px 0">Not scanned yet.</div>'; return; }
    box.innerHTML = cats().map(c => {
      const list = h[c.id] || []; const empty = !String(c.terms || '').trim();
      const open = scanState.open === c.id;
      const col = /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#ffcc00';
      return `<div class="cat"><div class="ch" data-c="${esc(c.id)}"><span class="dot" style="background:${col}"></span>${esc(c.label)}
        <span class="n">${empty ? '<span class="mut">no terms set</span>' : list.length}</span>
        <button class="btn ic" data-s="${esc(c.id)}" data-d="-1" title="Previous">‹</button><button class="btn ic" data-s="${esc(c.id)}" data-d="1" title="Next">›</button></div>
        ${open ? list.map((x, i) => `<div class="hit${scanState.cursor[c.id] === i ? ' cur' : ''}" data-h="${esc(c.id)}:${i}">${esc(x.before)}<mark>${esc(x.term)}</mark>${esc(x.after)}
          <div class="w">#${i + 1} of ${list.length}${x.heading ? ' · under “' + esc(x.heading) + '”' : ''} · <a data-r="1" style="color:#9cf;cursor:pointer">▶ read from here</a></div></div>`).join('') : ''}</div>`;
    }).join('');
    box.querySelectorAll('.ch').forEach(el => el.onclick = e => { if (e.target.closest('button')) return; scanState.open = scanState.open === el.dataset.c ? null : el.dataset.c; renderFind(); });
    box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { scanState.open = b.dataset.s; step(b.dataset.s, +b.dataset.d); });
    box.querySelectorAll('.hit').forEach(el => el.onclick = e => {
      const [c, i] = el.dataset.h.split(':'); const hit = h[c][+i];
      scanState.cursor[c] = +i;
      if (e.target.dataset.r) { readFromNode(hit.range.startContainer, hit.range.startOffset); return; }
      jumpTo(hit); renderFind();
    });
  }
  function toast(msg) {
    if (!ui) buildUI();
    const t = ui.$('toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', 3500);
  }

  // ---------------------------------------------------------------- Claude + notes
  const aiResult = { text: '', title: '' };
  const SRC_MAX = 200000;
  async function addSource({ title, url, text, kind }) {
    text = String(text || '').trim();
    if (!text) { toast('Nothing to add.'); return; }
    const cut = text.length > SRC_MAX;
    const item = { id: self.RAP_newId(), title: (title || 'Untitled').slice(0, 120), url, kind, text: text.slice(0, SRC_MAX), added: Date.now() };
    const { collection: cur = [] } = await chrome.storage.local.get('collection');
    await chrome.storage.local.set({ collection: [...cur, item] });
    showPanel(); setTab('ai');
    toast(`Added “${item.title.slice(0, 40)}”${cut ? ' (cut to 200,000 characters)' : ''}. ${cur.length + 1} source${cur.length ? 's' : ''} collected.`);
  }
  // Obsidian vault picker (desktop): the person chooses which vault, or Off.
  let vaultList = null;
  async function renderVault() {
    if (!window.RAP_DESKTOP || !ui) return;
    if (!vaultList) vaultList = (await chrome.runtime.sendMessage({ type: 'vault-list' }).catch(() => null))?.vaults || [];
    const sel = ui.$('vaultSel'); ui.$('vaultrow').hidden = false;
    const cur = S.vaultOn ? S.vaultPath : '';
    const known = vaultList.some(v => v.path === cur);
    sel.innerHTML = '<option value="">Off</option>' + vaultList.map(v => `<option value="${v.path.replace(/"/g, '&quot;')}">${v.label.replace(/</g, '&lt;')}</option>`).join('') +
      (cur && !known ? `<option value="${cur.replace(/"/g, '&quot;')}">${cur.split(/[\\/]/).pop().replace(/</g, '&lt;')}</option>` : '');
    sel.value = cur;
    sel.onchange = async () => { S = await self.RAP_setSettings({ vaultOn: !!sel.value, vaultPath: sel.value || S.vaultPath }); toast(sel.value ? 'Claude will also look in ' + sel.selectedOptions[0].textContent + '.' : 'Obsidian notes are off.'); };
  }
  // Voice: "connect my Work vault", "Claude, use the Creator vault", "disconnect the vault".
  async function setVaultByName(spoken) {
    if (!window.RAP_DESKTOP) return say('Obsidian vaults work in the desktop app.');
    vaultList = (await chrome.runtime.sendMessage({ type: 'vault-list' }).catch(() => null))?.vaults || [];
    const norm = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
    const want = norm(spoken.replace(/\b(my|the|obsidian|vault)\b/gi, ''));
    const hits = vaultList.filter(v => want && (norm(v.name).includes(want) || want.includes(norm(v.name))));
    if (!hits.length) return say(vaultList.length ? 'I could not find that vault. Your vaults are: ' + [...new Set(vaultList.map(v => v.name))].join(', ') + '.' : 'Obsidian has no vaults on this PC.');
    if (new Set(hits.map(v => v.name)).size > 1) return say('That matches more than one vault: ' + [...new Set(hits.map(v => v.name))].join(', ') + '. Say the full name.');
    const v = hits[0];
    S = await self.RAP_setSettings({ vaultOn: true, vaultPath: v.path }); renderVault();
    say(`Connected. Claude will also look in your ${v.name} vault${hits.length > 1 ? ', the copy in ' + v.label.replace(/^.*\(in |\)$/g, '') + '. Change it in the Claude tab if you meant the other one' : ''}.`);
  }
  async function renderAI() {
    if (!ui) return;
    renderVault();
    const on = S.claudeMode === 'code' || S.claudeMode === 'api';
    ui.$('aioff').hidden = on; ui.$('aion').hidden = !on;
    const used = collection.filter(inUse);
    ui.$('srcinfo').textContent = collection.length ? `${used.length} of ${collection.length} in use` : '';
    let lastDay = '';
    const sorted = [...collection].sort((a, b) => b.added - a.added);
    ui.$('srclist').innerHTML = sorted.length ? sorted.map(c => {
      const day = dayLabel(c.added); const head = day !== lastDay ? `<div class="mut" style="margin:6px 0 2px">${esc(day)}</div>` : ''; lastDay = day;
      const t = new Date(c.added).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return `${head}<div class="src" title="${esc(c.url || '')}">
        <input type="checkbox" data-u="${esc(c.id)}"${inUse(c) ? ' checked' : ''} title="Use this item">
        <span class="t">${esc(c.title)}</span><span class="k">${esc(t)} · ${esc(c.kind)} · ${Math.max(1, Math.round(c.text.length / 1000))}k</span>
        <button class="x" data-del="${esc(c.id)}" title="Remove">✕</button></div>`;
    }).join('')
      : '<div class="mut">Memory is empty. Add emails, pages or pasted text from any tab, then ask Claude to work across them. Items are dated: today\'s are used by default, older ones are offered if related. With nothing in memory, Claude uses the highlighted text or this page.</div>';
    ui.$('srclist').querySelectorAll('[data-u]').forEach(cb => cb.onchange = () => chrome.storage.local.set({ collection: collection.map(c => c.id === cb.dataset.u ? { ...c, use: cb.checked, useDay: new Date().toDateString() } : c) }));
    ui.$('srclist').querySelectorAll('[data-del]').forEach(b => b.onclick = () => chrome.storage.local.set({ collection: collection.filter(c => c.id !== b.dataset.del) }));
    const { kbIndex = [] } = await chrome.storage.local.get('kbIndex');
    const builtOn = self.RAP_BUILTIN_KB.filter(k => S.kbBuiltin[k.id] !== false).length;
    const upOn = kbIndex.filter(k => k.enabled !== false);
    const sw = upOn.filter(k => k.tag === 'standard-work').length;
    ui.$('kbinfo').innerHTML = `Reference library: ${builtOn} built-in guide${builtOn === 1 ? '' : 's'}, ${upOn.length} uploaded${sw ? ` (${sw} standard work)` : ''} · <a id="kbman" style="color:#9cf;cursor:pointer">manage</a>`;
    ui.$('kbman').onclick = () => chrome.runtime.sendMessage({ type: 'openOptions', section: 'claude' });
  }
  // Memory: today's items are used unless switched off; older items are only used if switched on.
  // A tick or untick lasts for the day it was made; the next day every item goes back to the default.
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const inUse = c => (c.use !== undefined && c.useDay === new Date().toDateString()) ? c.use : sameDay(c.added, Date.now());
  function dayLabel(t) {
    if (sameDay(t, Date.now())) return 'Today';
    if (sameDay(t, Date.now() - 864e5)) return 'Yesterday';
    return new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }
  // Runs a Claude task. opts: { text (force this text), extra (request), format, speak (read the answer aloud) }
  async function runClaude(task, opts = {}) {
    if (typeof opts === 'string') opts = { text: opts };
    showPanel(); setTab('ai');
    if (S.claudeMode !== 'code' && S.claudeMode !== 'api') { toast('Claude is off. Turn it on in Settings.'); return null; }
    const mem = [...collection].sort((a, b) => b.added - a.added);
    let sources = opts.text ? [{ title: document.title, url: location.href, text: opts.text, added: Date.now() }]
      : mem.filter(inUse).map(({ title, url, text, added }) => ({ title, url, text, added }));
    const older = opts.text ? [] : mem.filter(c => !inUse(c) && !sameDay(c.added, Date.now())).slice(0, 40).map(({ title, added }) => ({ title, added }));
    let note = `${sources.length} memory item${sources.length === 1 ? '' : 's'}`;
    if (!sources.length) {
      const sel = getSelection().toString().trim();
      sources = [{ title: document.title, url: location.href, text: sel || buildModel(pageRoot()).flat, added: Date.now() }];
      note = sel ? 'the highlighted text' : 'this page';
    }
    const format = opts.format || ui.$('fmt').value || 'auto';
    const extra = opts.extra ?? ui.$('extra').value;
    const names = { summarize: 'Summary', write: 'Draft', issues: 'Issues', connect: 'Connections', chat: 'Answer', research: 'Research' };
    // Research: the highlighted text is what to explain; the rest of the email or page is the background.
    let focus = '';
    if (task === 'research') {
      focus = opts.focus ?? getSelection().toString().trim();
      if (!focus && !String(opts.extra ?? ui.$('extra').value).trim()) { ui.$('aistat').textContent = 'Highlight the part you want explained (or type a question in the box), then press Research.'; return null; }
      if (focus && note === 'the highlighted text') { sources = [{ title: document.title, url: location.href, text: buildModel(pageRoot()).flat, added: Date.now() }]; note = 'this page'; }
      note += focus ? ' plus the highlighted text' : '';
    }
    ui.$('aistat').textContent = `Asking Claude (${S.claudeMode === 'code' ? 'Claude Code' : 'API'}) using ${note}…`;
    ui.$('aiout').hidden = true; ui.$('aiacts').hidden = true; ui.$('aiq').hidden = true; ui.$('aitop').hidden = true;
    root_busy(true);
    const r = await chrome.runtime.sendMessage({ type: 'claude', task, format, sources, older, extra, focus })
      .catch(e => ({ error: String(e.message || e) }));
    root_busy(false);
    if (r?.error) { ui.$('aistat').textContent = '⚠ ' + r.error; if (opts.speak) speakText('Sorry. ' + r.error); return null; }
    if (r.question) {                                   // Claude asked which format to use
      ui.$('aistat').textContent = r.question;
      const q = ui.$('aiq'); q.hidden = false;
      q.innerHTML = [['outlook', 'Outlook email'], ['word', 'Word document'], ['teams', 'Teams'], ['slack', 'Slack']].map(([v, l]) => `<button class="btn" data-f="${v}">${l}</button>`).join('');
      q.querySelectorAll('[data-f]').forEach(b => b.onclick = () => runClaude(task, { ...opts, format: b.dataset.f, extra }));
      if (opts.speak) speakText(r.question);
      return r;
    }
    aiResult.text = r.text; aiResult.format = r.format || null; aiResult.title = names[task] || 'Result';
    ui.$('aiout').textContent = r.text; ui.$('aiout').hidden = false; ui.$('aiacts').hidden = false; ui.$('aitop').hidden = false;
    ui.$('openOut').hidden = aiResult.format !== 'outlook'; ui.$('openWord').hidden = aiResult.format !== 'word';
    const notes = [];
    if (aiResult.format === 'outlook') notes.push('Draft only. Open in Outlook to review and send it yourself.');
    if (aiResult.format === 'teams' || aiResult.format === 'slack') notes.push(`Copy, then paste into ${aiResult.format === 'teams' ? 'Teams' : 'Slack'}. Nothing is posted for you.`);
    if (r.notes?.length) notes.push(...r.notes);
    ui.$('aistat').textContent = notes.join(' ') || 'Done.';
    if (opts.speak) speakText(task === 'write' ? r.text.slice(0, 600) : r.text);      // briefings are read in full
    return r;
  }
  async function saveResult(open) {
    if (window.RAP_DESKTOP && open && aiResult.format === 'outlook') {      // desktop: a real Outlook compose window (never sent)
      const r = await chrome.runtime.sendMessage({ type: 'outlook-draft', text: aiResult.text }).catch(e => ({ error: String(e) }));
      toast(r?.error ? 'Could not open Outlook: ' + r.error : (r.note || 'Draft opened in Outlook. Review it and press Send yourself.'));
      return;
    }
    const kind = aiResult.format === 'outlook' ? 'eml' : aiResult.format === 'word' ? 'docx' : 'md';
    const r = await chrome.runtime.sendMessage({ type: 'save', kind, title: aiResult.title + ' - ' + document.title, text: aiResult.text, source: location.href, open })
      .catch(e => ({ error: String(e) }));
    toast(r?.error ? 'Could not save: ' + r.error : (open && !r.opened ? `Saved. Click it in Chrome's downloads to open: ${r.where}` : `Saved: ${r.where}`));
  }
  // Read any text aloud without a page highlight (answers, confirmations).
  function speakText(t) { startReading(modelFromString(spokenText(t)), 0, 'answer'); }
  // What a listener should hear: no Subject/To headers, markdown or bullet symbols.
  function spokenText(t) {
    return String(t).replace(/^(To|CC|Cc):.*$/gm, '').replace(/^Subject:\s*/m, 'Subject: ').replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '').replace(/^[ \t]*[-*•+][ \t]+/gm, '')
      .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#`]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  function root_busy(b) { ui.root.querySelectorAll('[data-task]').forEach(x => x.disabled = b); }
  async function saveNote(kind, body) {
    const r = await chrome.runtime.sendMessage({ type: 'save', kind: 'md', title: `${kind} - ${document.title}`, text: body, source: location.href }).catch(e => ({ error: String(e) }));
    toast(r?.error ? 'Could not save: ' + r.error : `Saved: ${r.where}`);
  }

  // ---------------------------------------------------------------- voice commands
  // Uses Chrome's speech recognition (free; audio is processed by Google). Chrome asks once per site for the microphone.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const V = { on: false, rec: null };
  function heard(t, warn) { if (!ui) return; const h = ui.$('heard'); h.style.display = V.on || t ? 'block' : 'none'; h.style.color = warn ? '#ffb4a8' : ''; h.textContent = t ? (V.on ? '🎤 ' : '') + t : ''; }
  function toggleVoice() { if (window.RAP_DESKTOP) return pushToTalk(); V.on ? stopVoice() : startVoice(); }
  // Desktop: push-to-talk. Records until you pause (~1.2 s of quiet), then recognises the words on this PC (Whisper).
  async function pushToTalk() {
    if (V.on) return; showPanel();
    const wasPlaying = R.playing; if (wasPlaying) pauseReading();
    V.on = true; ui.$('mic').style.color = '#ff6b6b'; heard('Listening… speak now');
    let stream;
    const micDev = S.micLabel ? (await navigator.mediaDevices.enumerateDevices()).find(x => x.kind === 'audioinput' && x.label === S.micLabel) : null;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...(micDev ? { deviceId: { exact: micDev.deviceId } } : {}) } }); }
    catch (e) { V.on = false; ui.$('mic').style.color = ''; heard('Microphone not available: ' + e.message, true); return; }
    const ctx = new AudioContext({ sampleRate: 16000 }); const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1); const chunks = [];
    const t0 = performance.now(); let last = t0, spoke = false;
    proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d));
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      if (Math.sqrt(s / d.length) > 0.012) { last = performance.now(); spoke = true; }
    };
    src.connect(proc); proc.connect(ctx.destination);
    await new Promise(res => { const iv = setInterval(() => { const now = performance.now();
      if ((spoke && now - last > 1200) || now - t0 > 15000 || (!spoke && now - t0 > 5000)) { clearInterval(iv); res(); } }, 100); });
    proc.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); ctx.close();
    V.on = false; ui.$('mic').style.color = '';
    if (!spoke) { heard('Didn’t hear anything from the microphone. If you spoke, choose your microphone in ⚙ Settings → Reading & notes → Microphone and test it.', true); if (wasPlaying) resumeReading(); return; }
    heard('Working out what you said…');
    const pcm = new Float32Array(chunks.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of chunks) { pcm.set(c, o); o += c.length; }
    const r = await chrome.runtime.sendMessage({ type: 'stt', pcm }).catch(e => ({ error: String(e) }));
    if (r?.error || !r?.text) { heard('Could not understand: ' + (r?.error || 'no words'), true); if (wasPlaying) resumeReading(); return; }
    const matched = handleCommand(r.text);
    if (!matched && wasPlaying && R.m && !R.playing) resumeReading();
  }
  function startVoice() {
    showPanel();
    if (!SR) { toast('This browser has no speech recognition. Use Chrome or Edge.'); return; }
    V.on = true; ui.$('mic').style.color = '#ff6b6b'; heard('Listening… say “help” for commands.');
    const rec = new SR(); V.rec = rec;
    rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
    rec.onresult = e => {
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const t = e.results[k][0].transcript.trim();
        if (e.results[k].isFinal) handleCommand(t); else heard('“' + t + '”');
      }
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopVoice(); toast('Microphone blocked. Click the camera/mic icon in the address bar to allow it on this site.'); }
      else if (e.error !== 'no-speech' && e.error !== 'aborted') heard('Mic error: ' + e.error, true);
    };
    rec.onend = () => { if (V.on && V.rec === rec) { try { rec.start(); } catch {} } };        // Chrome stops after silence; keep listening
    try { rec.start(); } catch {}
  }
  function stopVoice() { V.on = false; const r = V.rec; V.rec = null; try { r?.stop(); } catch {} if (ui) { ui.$('mic').style.color = ''; heard(''); } }

  function lastParagraph() {
    const L = R.last; if (!L) return null;
    const f = L.m.flat, p = Math.min(L.pos, f.length - 1);
    const s = f.lastIndexOf('\n', p - 1) + 1; let e = f.indexOf('\n', p); if (e < 0) e = f.length;
    return { m: L.m, s, e, text: f.slice(s, e).trim() };
  }
  function lastSentence() {
    const L = R.last; if (!L) return null;
    const sen = sentencesOf(L.m.flat).find(x => x.e > L.pos) || null;
    return sen && { m: L.m, s: sen.s, e: sen.e, text: L.m.flat.slice(sen.s, sen.e) };
  }
  function readRange(x) {
    if (!x) { say('Nothing has been read yet.'); return; }
    const keep = R.last;
    startReading(sliceModel(x.m, x.s, x.e), 0, 'answer');      // 'answer' = don't move "last read"
    R.label = 'page'; R.last = keep; setTab('read');
  }
  // A model limited to one stretch of an existing model, so the page highlight still works.
  function sliceModel(m, s, e) {
    const segs = []; let flat = '', prevEnd = -1;
    for (const g of m.segs) {
      const a = Math.max(s, g.f), b = Math.min(e, g.f + (g.b - g.a)); if (b <= a) continue;
      if (prevEnd >= 0 && m.flat.slice(prevEnd, a).includes('\n')) flat += '\n';
      segs.push({ node: g.node, a: g.a + (a - g.f), b: g.a + (b - g.f), f: flat.length });
      flat += m.flat.slice(a, b); prevEnd = b;
    }
    return segs.length ? { flat, segs, headings: [], nodeIndex: new Map(segs.map((x, i) => [x.node, i])) } : modelFromString(m.flat.slice(s, e));
  }
  function say(t) { heard(t); speakText(t); }

  const HELP = 'You can say: stop, pause, continue, start over, read last sentence, read last paragraph, go back, skip, faster, slower, read this page, read highlighted, ' +
    'add last paragraph to memory, add last sentence to memory, add this page to memory, add highlighted to memory, scan, summarize, connect the dots, list issues, ' +
    'write an email about something, write a document about something, Teams message about something, read it, open in Outlook, open in Word, save it, copy it, ' +
    'research or explain something, connect my vault name vault, disconnect the vault, open the manual, ' +
    'or start with the word Claude to ask a question, for example: Claude, what were the safety issues. Say stop listening to turn the mic off.';
  const COMMANDS = [
    [/^(stop listening|mic off|microphone off)$/, () => { say('Microphone off.'); stopVoice(); }],
    [/^(stop|quiet|be quiet|shut up|cancel)$/, () => stopReading()],
    [/^(pause|hold on|wait)$/, () => pauseReading()],
    [/^(continue|resume|go on|keep going|play)$/, () => R.m ? resumeReading() : say('Nothing is paused.')],
    [/^(start over|from the top|restart|start again|read it again from the start)$/, () => R.last ? startReading(R.last.m, 0, R.last.label) : readPage()],
    [/(read|repeat) (that |the )?(last |previous )?sentence( again)?|^repeat that$|^say that again$/, () => readRange(lastSentence())],
    [/(read|repeat) (that |the )?(last |previous )?paragraph( again)?/, () => readRange(lastParagraph())],
    [/^(go back|back|previous|previous sentence)$/, () => skip(-1)],
    [/^(skip|next|next sentence|skip ahead)$/, () => skip(1)],
    [/^(faster|speed up|read faster)$/, () => { save({ rate: Math.min(3, Math.round((+S.rate + 0.2) * 10) / 10) }); syncControls(); restartAtCurrent(); }],
    [/^(slower|slow down|read slower)$/, () => { save({ rate: Math.max(0.5, Math.round((+S.rate - 0.2) * 10) / 10) }); syncControls(); restartAtCurrent(); }],
    [/^read (this |the )?(page|email|whole page|everything)$/, () => readPage()],
    [/^read (the )?(highlighted|selection|selected)( text)?$/, () => readSelection()],
    [/add (the |that )?(last )?paragraph to memory/, () => { const p = lastParagraph(); p ? addSource({ title: 'Paragraph: ' + p.text.slice(0, 50), url: location.href, text: p.text, kind: 'paragraph' }).then(() => say('Paragraph added to memory.')) : say('Nothing has been read yet.'); }],
    [/add (the |that )?(last )?sentence to memory/, () => { const p = lastSentence(); p ? addSource({ title: 'Sentence: ' + p.text.slice(0, 50), url: location.href, text: p.text, kind: 'sentence' }).then(() => say('Sentence added to memory.')) : say('Nothing has been read yet.'); }],
    [/add (the )?(highlighted|selection|selected)( text)? to memory/, () => { const t = getSelection().toString().trim(); t ? addSource({ title: document.title, url: location.href, text: t, kind: 'highlighted' }).then(() => say('Added to memory.')) : say('Nothing is highlighted.'); }],
    [/add (all|everything|this page|the page|the whole page|this email|it all)( to memory)?$|add (all|everything) to memory/, () => addSource({ title: document.title, url: location.href, text: buildModel(pageRoot()).flat, kind: 'page' }).then(() => say('Page added to memory.'))],
    [/^(clear|empty) (the )?memory$/, () => { if (confirm('Clear all memory items?')) chrome.storage.local.set({ collection: [] }).then(() => say('Memory cleared.')); }],
    [/^(scan|find|scan (the |this )?page|highlight words)$/, () => { showPanel(); setTab('find'); const h = scan(); const n = Object.values(h).reduce((a, l) => a + l.length, 0); say(`Found ${n} highlight${n === 1 ? '' : 's'}.`); }],
    [/^(summarize|summarise|give me a summary|sum it up)\b(.*)/, (m, t) => runClaude('summarize', { extra: t, speak: true })],
    [/^connect (the )?dots\b/, (m, t) => runClaude('connect', { extra: t }).then(r => r && !r.question && say('Done. The connections are in the panel.'))],
    [/^(list|find) (the )?issues\b/, (m, t) => runClaude('issues', { extra: t }).then(r => r && !r.question && say('Done. The issues are in the panel.'))],
    [/\b(compose|write|draft|reply|respond)\b.*\b(email|e-mail|mail|reply|response)\b|^(reply|respond) to\b/, (m, t) => runClaude('write', { format: 'outlook', extra: t }).then(r => r && !r.question && say('Email draft ready. Say read it, or open in Outlook.'))],
    [/\b(write|draft|create|make)\b.*\b(document|doc|memo|report|procedure|word)\b/, (m, t) => runClaude('write', { format: 'word', extra: t }).then(r => r && !r.question && say('Document ready. Say read it, or open in Word.'))],
    [/\bteams\b/, (m, t) => runClaude('write', { format: 'teams', extra: t }).then(r => r && !r.question && say('Teams message ready. Say copy it.'))],
    [/\bslack\b/, (m, t) => runClaude('write', { format: 'slack', extra: t }).then(r => r && !r.question && say('Slack message ready. Say copy it.'))],
    [/^(?:(?:hey |ok |okay )?claude[, ]+)?(?:connect|use|search|turn on|switch to) (?:to )?(?:my |the )?(.+?) (?:obsidian )?vault$/, (m) => setVaultByName(m[1])],
    [/^(?:(?:hey |ok |okay )?claude[, ]+)?(?:disconnect|turn off|stop using) (?:the |my )?(?:obsidian )?vault$/, async () => { S = await self.RAP_setSettings({ vaultOn: false }); renderVault(); say('Obsidian notes are off.'); }],
    [/^(research|explain|look up)\b(.*)/, (m, t) => runClaude('research', { extra: (m[2] || '').trim(), speak: true })],
    [/^(read it|read that|read the (draft|answer|result|email|document))$/, () => aiResult.text ? speakText(aiResult.text) : say('There is no draft yet.')],
    [/^open (it )?in outlook$/, () => aiResult.format === 'outlook' ? saveResult(true) : say('The last result is not an email.')],
    [/^open (it )?in word$/, () => aiResult.text ? (aiResult.format = 'word', saveResult(true)) : say('There is nothing to open.')],
    [/^save (it|that|the draft|the result)$/, () => aiResult.text ? saveResult(false) : say('There is nothing to save.')],
    [/^copy (it|that|the draft|the result)$/, () => { if (!aiResult.text) return say('There is nothing to copy.'); navigator.clipboard.writeText(aiResult.text).then(() => say('Copied.'), () => say('Copy was blocked. Click Copy in the panel.')); }],
    [/^(open|show)( me)? the manual$|^(open )?manual$/, () => { chrome.runtime.sendMessage({ type: 'open-manual' }); say('Opening the manual.'); }],
    [/^(help|what can i say|commands)$/, () => say(HELP)],
    [/^(hey |ok |okay )?claude[, ]+(.+)|^(ask|question)[: ]+(.+)/, (m) => runClaude('chat', { extra: m[2] || m[4], speak: true })]
  ];
  // True when most words heard are words the reader is saying right now (speakers picked up by the mic).
  function isEcho(t) {
    const speaking = synth?.speaking || (elAudio && !elAudio.paused);
    if (!speaking || !R.m) return false;
    const heardW = t.split(/\s+/).filter(w => w.length > 2);
    if (heardW.length < 3) return false;                    // short commands like "stop" always count
    const near = R.m.flat.slice(Math.max(0, R.pos - 300), R.pos + 300).toLowerCase();
    const hits = heardW.filter(w => near.includes(w)).length;
    return hits / heardW.length >= 0.6;
  }
  function handleCommand(raw) {
    const t = raw.toLowerCase().replace(/[.?!,]+$/g, '').replace(/^(please |can you |could you )/, '').trim();
    if (!t) return false;
    if (isEcho(t)) return true;                             // the microphone heard the reader's own voice
    heard('“' + raw + '”');
    for (const [re, fn] of COMMANDS) { const m = t.match(re); if (m) { fn(m, raw); return true; } }
    heard(`Not a command: “${raw}”. To ask a question, start with “Claude”. Say help for the list.`, true);   // no wake word: never sent to Claude
    return false;
  }

  // ---------------------------------------------------------------- messages from background
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    ready.then(() => {
      switch (msg.type) {
        case 'toggle': togglePanel(); break;
        case 'read-selection': readSelectionOrPage(); break;
        case 'read-page': readPage(); break;
        case 'read-here': lastContext ? readFromNode(lastContext.node, lastContext.off) : readPage(); break;
        case 'pause-resume': togglePause(); break;
        case 'voice': toggleVoice(); break;
        case 'stop': stopReading(); break;
        case 'scan': showPanel(); setTab('find'); scan(); break;
        case 'claude-summarize': runClaude('summarize', msg.text); break;
        case 'collect-selection': addSource({ title: document.title, url: location.href, text: msg.text || getSelection().toString(), kind: 'highlighted' }); break;
        case 'collect-page': addSource({ title: document.title, url: location.href, text: buildModel(pageRoot()).flat, kind: 'page' }); break;
      }
      reply({ ok: true });
    });
    return true;
  });

  window.__rap = { scan, readPage, readSelection, readFromNode, stopReading, togglePanel, buildModel, sentencesOf, termRegex, addSource, setTab, handleCommand, lastParagraph, lastSentence, runClaude, R, scanState, aiResult, settings: () => S };
})();
