// Minimal ZIP reader for Office documents (DOCX/XLSX/PPTX/ODT). Uses the browser's DecompressionStream.

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function listEntries(buf) {
  const view = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count && view.getUint32(p, true) === CENTRAL; i++) {
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    entries.push({ name, method, compressed, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export async function readEntry(buf, entry, maxBytes = 5_000_000) {
  if (entry.size > maxBytes) throw new Error('Entry too large');
  const view = new DataView(buf);
  if (view.getUint32(entry.offset, true) !== LOCAL) throw new Error('Bad local header');
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const data = new Uint8Array(buf, start, entry.compressed);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error(`Unsupported compression ${entry.method}`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}
