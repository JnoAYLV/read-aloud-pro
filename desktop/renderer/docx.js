// Minimal .docx text extractor: reads word/document.xml out of the zip with the browser's own
// DecompressionStream (no libraries), then joins paragraph text.
self.RAP_docxText = async function (arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  let eocd = arrayBuffer.byteLength - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a valid .docx (zip) file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(arrayBuffer, p + 46, nlen));
    files[name] = { method, csize, lho };
    p += 46 + nlen + xlen + clen;
  }
  async function read(name) {
    const f = files[name]; if (!f) return null;
    const start = f.lho + 30 + dv.getUint16(f.lho + 26, true) + dv.getUint16(f.lho + 28, true);
    const data = new Uint8Array(arrayBuffer, start, f.csize);
    if (f.method === 0) return dec.decode(data);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }
  const xml = await read('word/document.xml');
  if (!xml) throw new Error('No document text found in this .docx');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out = [];
  for (const para of doc.getElementsByTagName('w:p')) {
    let line = '';
    const style = para.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || '';
    for (const n of para.getElementsByTagName('*')) {
      if (n.tagName === 'w:t') line += n.textContent;
      else if (n.tagName === 'w:tab') line += '\t';
      else if (n.tagName === 'w:br') line += '\n';
    }
    const isList = para.getElementsByTagName('w:numPr').length > 0;
    if (/^Heading(\d)/i.test(style)) line = '#'.repeat(Math.min(6, +style.match(/\d/)[0])) + ' ' + line;
    else if (isList && line.trim()) line = '- ' + line;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
