// Builds renderer/settings.html from the extension's options.html, adapted for the desktop app.
// Re-run after changing options.html:  node tools/make-settings.js
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..', 'renderer');
let h = fs.readFileSync(path.join(R, 'options.html'), 'utf8');
const swap = (from, to) => { if (!h.includes(from)) throw new Error('settings template changed; not found: ' + from.slice(0, 60)); h = h.replace(from, to); };

swap('<script src="defaults.js"></script>', '<script src="shim.js"></script>\n<script src="defaults.js"></script>\n<script src="tour.js"></script>');
swap('<script src="options.js"></script>', '<script src="options.js"></script>\n<script src="settings-desktop.js"></script>');
swap('<div class="mode" data-e="browser">',
  `<div class="mode" data-e="kokoro"><label class="chk"><input type="radio" name="engine" value="kokoro"> <b>Natural voices on this PC (free, recommended)</b>: Kokoro, runs offline</label>
    <div class="row">Voice: <select id="kokoroVoice" style="min-width:260px"><option>Loading…</option></select><button id="kTest">Play a test sentence</button><span class="msg" id="msgK"></span></div>
    <div class="hint">28 voices, free, private (nothing leaves this PC). The speaker below applies to these voices.</div></div>
  <div class="mode" data-e="browser">`);
swap('<b>Built-in voices (free)</b>: pick one in the panel', '<b>Windows voices (free, robotic)</b>: pick one in the panel');
swap(/Needs Claude Code installed and signed in, plus a one-time helper install:[\s\S]*?Usage counts against your Claude plan\./.exec(h)[0],
  'Needs Claude Code installed and signed in on this PC (check: open a terminal, type <code>claude</code>; if it says the login expired, type <code>/login</code>). Usage counts against your Claude plan.');
swap(/<div class="hint">This extension's ID[\s\S]*?<\/div>/.exec(h)[0], '');
swap('Any folder on this computer, e.g. Google Drive or OneDrive (needs the Claude Code helper installed):', 'Any folder on this computer, e.g. Google Drive or OneDrive:');
swap('<title>Read Aloud Pro – Settings</title>', '<title>Read Aloud Pro – Settings</title>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; media-src \'self\' data: blob:; img-src \'self\' data:">');
swap('<h2>Speaker</h2>', `<h2>Microphone (voice commands)</h2>
  <div class="row"><select id="micSel" style="min-width:320px"><option value="">Windows default microphone</option></select><button id="micTest">Test: speak for 3 seconds</button></div>
  <div class="row"><div style="flex:1;max-width:420px;height:12px;background:#ddd;border-radius:6px;overflow:hidden"><div id="micBar" style="height:100%;width:0;background:#2a9d4b"></div></div><span class="msg" id="msgMic"></span></div>
  <div class="hint">If the bar does not move when you talk, pick another microphone. Virtual mics (SteelSeries Sonar, Voicemeeter) only work when that program is passing your real mic through.</div>
  <h2>Speaker</h2>`);swap('<h2>Reference library</h2>', `<h2>Obsidian vault (optional)</h2>
  <label class="chk"><input type="checkbox" id="vaultOn"> Search my Obsidian vault for related notes when Claude writes, researches or answers</label>
  <div class="row"><input type="text" id="vaultPath" placeholder="Vault folder, e.g. C:\\Users\\you\\Documents\\Vaults\\Work" style="flex:1;min-width:320px"><button id="vaultPick">Choose folder…</button></div>
  <div class="row">Skip these folders: <input type="text" id="vaultExclude" style="flex:1;min-width:220px" placeholder="Templates, Attachments"><button id="vaultSave">Save</button><button id="vaultTest">Test</button><span class="msg" id="msgVault"></span></div>
  <div class="hint">Notes stay on this PC; only the few that match a request (up to about 5,000 characters each) are sent to Claude with it, and the answer lists which ones were used. Summaries never use the vault. Pick the vault that fits this work, and leave out vaults or folders with private notes (health, money, family).</div>
  <h2>Reference library</h2>`);// Wording left over from the browser extension, rewritten for the desktop app.
swap(/<div class="hint">Windows voices \(David, Mark, Zira\)[\s\S]*?<\/div><\/div>/.exec(h)[0],
  '<div class="hint">Windows\' own voices (David, Mark, Zira). They sound robotic but highlight each word exactly. They always play on the Windows default speaker.</div></div>');
swap(/<div class="hint">Choosing a speaker works with ElevenLabs voices[\s\S]*?<\/div>/.exec(h)[0],
  '<div class="hint">The natural voices play on the speaker chosen here. Windows voices always use the Windows default speaker.</div>');
swap("A folder inside Chrome's Downloads folder:", 'A folder inside your Downloads folder:');
swap(/<div class="box" style="margin-top:14px">Shortcuts:[\s\S]*?<\/div>/.exec(h)[0],
  `<h2>Shortcut keys</h2>
  <div class="hint">These work in every program while Read Aloud Pro runs. To change one, click its box and press the keys you want (Ctrl or Alt plus a key). You are warned if Windows or another program already uses them. In the reader, Esc stops and Alt+click starts reading at a word.</div>
  <table id="hkTable"><tbody></tbody></table>
  <div class="row"><button class="pri" id="hkSave">Save shortcut keys</button><button id="hkReset">Back to the defaults</button><span class="msg" id="msgHk"></span></div>`);swap('Emails are drafts only. This extension cannot send email.', 'Emails are drafts only. This app cannot send email: Outlook drafts open for you to review and send yourself.');fs.writeFileSync(path.join(R, 'settings.html'), h);
console.log('settings.html written');
