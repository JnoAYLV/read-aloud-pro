// Builds files people open in Office: an Outlook draft (.eml) and a Word document (.docx).
// No libraries. The .docx is a small zip written by hand (stored, not compressed).
(() => {
  const enc = new TextEncoder();
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const htmlEsc = xmlEsc;

  // Light markdown → pieces: headings (#), bullets (- or •), numbered (1.), bold (**x**), paragraphs.
  function parse(md) {
    return String(md).replace(/\r/g, '').split('\n').map(line => {
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)/))) return { kind: 'h' + m[1].length, text: m[2] };
      if ((m = line.match(/^\s*[-*•]\s+(.*)/))) return { kind: 'bullet', text: m[1] };
      if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)/))) return { kind: 'num', n: m[1], text: m[2] };
      if (!line.trim()) return { kind: 'blank' };
      return { kind: 'p', text: line };
    });
  }
  const runs = text => text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(t => /^\*\*.*\*\*$/.test(t) ? { b: true, t: t.slice(2, -2) } : { t });

  // Pull "Subject:" and "To:"/"Cc:" lines off the top of an email draft.
  function splitEmail(text) {
    const lines = String(text).replace(/\r/g, '').split('\n'); const head = {}; let i = 0;
    while (i < lines.length && i < 6) {
      const m = lines[i].match(/^\s*\**(Subject|To|Cc)\**\s*:\s*(.*)$/i);
      if (m) { head[m[1].toLowerCase()] = m[2].trim(); i++; } else if (!lines[i].trim() && Object.keys(head).length) { i++; break; } else break;
    }
    return { subject: head.subject || '', to: head.to || '', cc: head.cc || '', body: lines.slice(i).join('\n').trim() };
  }

  function emailHtml(body) {
    const out = []; let list = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const p of parse(body)) {
      const inner = runs(p.text || '').map(r => r.b ? `<b>${htmlEsc(r.t)}</b>` : htmlEsc(r.t)).join('');
      if (p.kind === 'bullet' || p.kind === 'num') {
        const want = p.kind === 'bullet' ? 'ul' : 'ol'; if (list !== want) { close(); out.push(`<${want} style="margin:0 0 8pt 0">`); list = want; }
        out.push(`<li>${inner}</li>`);
      } else {
        close();
        if (p.kind === 'blank') continue;
        if (p.kind.startsWith('h')) out.push(`<p style="margin:10pt 0 4pt 0"><b>${inner}</b></p>`);
        else out.push(`<p style="margin:0 0 8pt 0">${inner}</p>`);
      }
    }
    close();
    return `<html><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${out.join('\n')}</body></html>`;
  }

  // .eml with X-Unsent: 1 opens in Outlook as a new, unsent draft the person reviews and sends.
  function makeEml(text) {
    const e = splitEmail(text);
    const hdr = s => s ? `=?UTF-8?B?${b64(enc.encode(s))}?=` : '';
    const addr = s => (s.match(/[^\s,;<>]+@[^\s,;<>]+/g) || []).join(', ');      // only real addresses; names stay in the body
    const html = b64(enc.encode(emailHtml(e.body))).replace(/.{76}/g, '$&\r\n');
    const eml = [
      'X-Unsent: 1', `To: ${addr(e.to)}`, addr(e.cc) ? `Cc: ${addr(e.cc)}` : null, `Subject: ${hdr(e.subject)}`,
      'MIME-Version: 1.0', 'Content-Type: text/html; charset="utf-8"', 'Content-Transfer-Encoding: base64', '', html, ''
    ].filter(l => l !== null).join('\r\n');
    return { bytes: enc.encode(eml), subject: e.subject, toNames: e.to };
  }

  // ---- docx
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const parts = [], central = []; let off = 0;
    for (const [name, str] of files) {
      const data = enc.encode(str), nm = enc.encode(name), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
      parts.push(new Uint8Array(lh.buffer), nm, data); central.push(new Uint8Array(ch.buffer), nm);
      off += 30 + nm.length + data.length;
    }
    const csize = central.reduce((n, a) => n + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0)); let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  function makeDocx(text, title) {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const run = r => `<w:r>${r.b ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(r.t)}</w:t></w:r>`;
    const para = (style, inner, ind) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${ind ? '<w:ind w:left="360" w:hanging="360"/>' : ''}</w:pPr>${inner}</w:p>`;
    const body = parse(text).filter(p => p.kind !== 'blank').map(p => {
      if (p.kind === 'h1') return para('Heading1', runs(p.text).map(run).join(''));
      if (p.kind === 'h2') return para('Heading2', runs(p.text).map(run).join(''));
      if (p.kind === 'h3') return para('Heading3', runs(p.text).map(run).join(''));
      if (p.kind === 'bullet') return para(null, run({ t: '•\t' }) + runs(p.text).map(run).join(''), true);
      if (p.kind === 'num') return para(null, run({ t: p.n + '.\t' }) + runs(p.text).map(run).join(''), true);
      return para(null, runs(p.text).map(run).join(''));
    }).join('');
    const style = (id, name, size, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${id !== 'Normal' ? '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' : ''}<w:pPr><w:spacing w:before="${id === 'Normal' ? 0 : 200}" w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${extra}<w:sz w:val="${size}"/></w:rPr></w:style>`;
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
      ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEsc(title || '')}</dc:title><dc:creator>Read Aloud Pro</dc:creator></cp:coreProperties>`],
      ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>${style('Normal', 'Normal', 22)}${style('Heading1', 'heading 1', 32, '<w:b/><w:color w:val="1F3864"/>')}${style('Heading2', 'heading 2', 26, '<w:b/><w:color w:val="2F5496"/>')}${style('Heading3', 'heading 3', 24, '<w:b/>')}</w:styles>`],
      ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`]
    ]);
  }

  self.RAP_doc = { makeEml, makeDocx, splitEmail, emailHtml, b64 };
})();
