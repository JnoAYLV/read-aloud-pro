// Builds renderer/manual.html (the in-app manual, works offline) from ../MANUAL.md.
// Re-run after editing MANUAL.md:  node tools/make-manual.js
// Handles the markdown the manual uses: # / ## headings, paragraphs, - and 1. lists (one nested level),
// pipe tables, **bold**, *italic*, `code`, and \[ \] escapes.
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', '..', 'MANUAL.md');
const OUT = path.join(__dirname, '..', 'renderer', 'manual.html');

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s).replace(/\\\[/g, '[').replace(/\\\]/g, ']').replace(/\\\\/g, '\\')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<i>$2</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}
const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const lines = fs.readFileSync(SRC, 'utf8').replace(/\r/g, '').split('\n');
let html = '', title = 'Manual', sub = '';
const toc = [];
let i = 0;
while (i < lines.length) {
  const l = lines[i];
  if (!l.trim()) { i++; continue; }
  if (l.startsWith('# ')) { title = l.slice(2).trim(); i++; continue; }
  if (l.startsWith('## ')) { const t = l.slice(3).trim(), id = slug(t); toc.push({ t, id }); html += `<h2 id="${id}">${inline(t)}</h2>\n`; i++; continue; }
  if (l.startsWith('|')) {                                      // table: header, separator, rows
    const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
    const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    html += '<table><thead><tr>' + cells(rows[0]).map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.slice(2).map(r => '<tr>' + cells(r).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>\n';
    continue;
  }
  if (/^(\d+\.|-)\s/.test(l)) {                                 // list, with one nested level of "   - "
    const ordered = /^\d+\./.test(l), items = [];
    while (i < lines.length && (/^(\d+\.|-)\s/.test(lines[i]) || /^\s{2,}-\s/.test(lines[i]))) {
      const x = lines[i++];
      if (/^\s{2,}-\s/.test(x) && items.length) items[items.length - 1].subs.push(x.replace(/^\s+-\s/, ''));
      else items.push({ text: x.replace(/^(\d+\.|-)\s/, ''), subs: [] });
    }
    const tag = ordered ? 'ol' : 'ul';
    html += `<${tag}>` + items.map(it => `<li>${inline(it.text)}${it.subs.length ? '<ul>' + it.subs.map(s => `<li>${inline(s)}</li>`).join('') + '</ul>' : ''}</li>`).join('') + `</${tag}>\n`;
    continue;
  }  if (!sub && html === '') { sub = l.trim(); i++; continue; }  // the line under the title
  const para = []; while (i < lines.length && lines[i].trim() && !/^(#|\||-\s|\d+\.\s)/.test(lines[i])) para.push(lines[i++].trim());
  html += `<p>${inline(para.join(' '))}</p>\n`;
}

const page = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:">
<title>${esc(title)}</title>
<style>
  body{margin:0;font:15px/1.6 "Segoe UI",system-ui,sans-serif;color:#1d2330;background:#f6f7f9;display:flex}
  nav{position:sticky;top:0;height:100vh;overflow:auto;width:250px;flex:none;background:#26292f;color:#ddd;padding:18px 14px;box-sizing:border-box}
  nav b{display:block;color:#ffd84a;font-size:16px;margin-bottom:4px} nav .s{color:#99a;font-size:12px;margin-bottom:14px}
  nav a{display:block;color:#ddd;text-decoration:none;padding:5px 8px;border-radius:6px;font-size:13.5px}
  nav a:hover{background:#33363d;color:#fff}
  main{flex:1;max-width:860px;padding:28px 44px 80px}
  h1{font-size:28px;margin:0 0 2px} .sub{color:#667;margin-bottom:18px}
  h2{font-size:21px;margin:36px 0 10px;padding-top:12px;border-top:1px solid #dde1e7}
  table{border-collapse:collapse;width:100%;margin:12px 0 16px;background:#fff;font-size:14px}
  th,td{border:1px solid #d9dde4;padding:7px 10px;text-align:left;vertical-align:top} th{background:#eef1f5}
  code{background:#eceff3;padding:1px 5px;border-radius:4px;font-size:13px}
  li{margin:3px 0} b{color:#111}
</style></head>
<body><nav><b>🔊 ${esc(title)}</b><div class="s">${inline(sub)}</div>${toc.map(x => `<a href="#${x.id}">${inline(x.t)}</a>`).join('')}</nav>
<main><h1>${esc(title)}</h1><div class="sub">${inline(sub)}</div>
${html}</main></body></html>
`;
fs.writeFileSync(OUT, page);
console.log(`manual.html written: ${toc.length} sections`);
