// Text and structure extraction for the document workspace, on the user's device. PDF parsing (pdf.js) and
// OCR (tesseract.js) run in Web Workers. HTML and XML are parsed into inert documents: no script runs and
// nothing is fetched. ZIP entries are size-capped (zip bombs), and PDFs never get eval or scripting.
//
// Result: { kind, label, signature, sha256, sha1, text, pages: [{ n, text, ocr }], meta, links, tables,
//           tracked: { inserted, deleted }, warnings, ocrPages }

import { listEntries, readEntry } from '../zip.js';
import { identify, extOf } from './signature.js';
import { ocr } from './ocr.js';
import { imageForensics, videoFrames, parseSubtitles, cueTime } from './media.js';

export const MAX_TEXT = 2_000_000; // characters kept per document
const MAX_PDF_PAGES = 400;
const MAX_OCR_PAGES = 30;
const MAX_ROWS = 20_000;

async function digest(algo, buf) {
  const d = await crypto.subtle.digest(algo, buf);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const tagText = (doc, tag) => doc?.getElementsByTagName(tag)[0]?.textContent?.trim() || null;
const cap = (s) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);

function pdfDate(s) {
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s || '');
  if (!m) return s || null;
  return `${m[1]}-${m[2] || '01'}-${m[3] || '01'}${m[4] ? `T${m[4]}:${m[5] || '00'}` : ''}`;
}

/* ---------------- PDF ---------------- */
async function pdf(buf, opts, out) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false, enableXfa: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const meta = await doc.getMetadata().catch(() => ({ info: {} }));
  const info = meta.info || {};
  const xmp = meta.metadata?.getAll?.() || {};
  const n = Math.min(doc.numPages, MAX_PDF_PAGES);
  let total = 0;
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    for (const a of await page.getAnnotations().catch(() => [])) if (a.url) out.links.add(a.url);
    const tc = await page.getTextContent();
    // Keep line breaks: pdf.js marks the end of a line with hasEOL.
    const text = tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n');
    total += text.trim().length;
    out.pages.push({ n: i, text, ocr: false });
    opts.onProgress?.(`Reading page ${i} of ${n}`);
  }
  // A scanned PDF has (almost) no text layer: render pages and OCR them.
  if (opts.ocr !== false && total < 25 * n) {
    const pages = Math.min(n, MAX_OCR_PAGES);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      const r = await ocr(canvas, (m) => m.status === 'recognizing text' && opts.onProgress?.(`OCR page ${i} of ${pages}: ${Math.round(m.progress * 100)}%`));
      out.pages[i - 1] = { n: i, text: r.text, ocr: true, confidence: r.confidence };
      out.ocrPages++;
      canvas.width = 0;
    }
    if (n > pages) out.warnings.push(`OCR covered the first ${pages} of ${n} pages.`);
  }
  if (doc.numPages > MAX_PDF_PAGES) out.warnings.push(`Only the first ${MAX_PDF_PAGES} of ${doc.numPages} pages were read.`);
  const js = await doc.getJSActions().catch(() => null);
  const attachments = await doc.getAttachments().catch(() => null);
  Object.assign(out.meta, {
    title: info.Title || xmp['dc:title'] || null, author: info.Author || xmp['dc:creator'] || null, subject: info.Subject || null, keywords: info.Keywords || null,
    creator: info.Creator || xmp['xmp:creatortool'] || null, producer: info.Producer || xmp['pdf:producer'] || null,
    created: pdfDate(info.CreationDate) || xmp['xmp:createdate'] || null, modified: pdfDate(info.ModDate) || xmp['xmp:modifydate'] || null,
    pdfVersion: info.PDFFormatVersion || null, pageCount: doc.numPages, encrypted: !!info.EncryptFilterName,
    javascript: !!(js && Object.keys(js).length), attachments: attachments ? Object.keys(attachments) : [],
  });
  if (out.meta.javascript) out.warnings.push('Contains document JavaScript (detected, not executed).');
  if (out.meta.attachments.length) out.warnings.push(`Contains ${out.meta.attachments.length} embedded file(s): ${out.meta.attachments.slice(0, 5).join(', ')}.`);
  await task.destroy();
}

/* ---------------- Office Open XML and OpenDocument ---------------- */
function wordText(doc) {
  // Paragraph by paragraph; tabs and breaks kept. Deleted runs (tracked changes) are collected separately.
  const out = [];
  for (const p of doc.getElementsByTagName('w:p')) {
    let line = '';
    for (const el of p.getElementsByTagName('*')) {
      if (el.tagName === 'w:t') line += el.textContent; // deleted text sits in w:delText, not w:t
      else if (el.tagName === 'w:tab') line += '\t';
      else if (el.tagName === 'w:br') line += '\n';
    }
    out.push(line);
  }
  return out.join('\n');
}

async function office(buf, out) {
  const entries = listEntries(buf);
  const by = new Map(entries.map((e) => [e.name, e]));
  const read = async (name) => (by.has(name) ? readEntry(buf, by.get(name), 25_000_000).catch(() => null) : null);
  const parse = async (name) => {
    const s = await read(name);
    return s ? xml(s) : null;
  };

  // Properties (OOXML)
  const core = await parse('docProps/core.xml');
  const app = await parse('docProps/app.xml');
  if (core || app) {
    Object.assign(out.meta, {
      title: tagText(core, 'dc:title'), author: tagText(core, 'dc:creator'), lastModifiedBy: tagText(core, 'cp:lastModifiedBy'),
      created: tagText(core, 'dcterms:created'), modified: tagText(core, 'dcterms:modified'), revision: tagText(core, 'cp:revision'),
      application: [tagText(app, 'Application'), tagText(app, 'AppVersion')].filter(Boolean).join(' ') || null, company: tagText(app, 'Company'),
      template: tagText(app, 'Template'), editMinutes: tagText(app, 'TotalTime'),
    });
  }
  out.meta.macros = entries.some((e) => /vbaProject\.bin$/i.test(e.name));
  out.meta.media = entries.filter((e) => /\/media\/|^Pictures\//.test(e.name)).length;
  if (out.meta.macros) out.warnings.push('Contains VBA macros (not run).');

  // External hyperlinks from relationship files
  for (const e of entries.filter((x) => x.name.endsWith('.rels'))) {
    const rels = xml((await readEntry(buf, e).catch(() => '')) || '<r/>');
    for (const r of rels.getElementsByTagName('Relationship')) if (r.getAttribute('TargetMode') === 'External' && /^https?:/i.test(r.getAttribute('Target') || '')) out.links.add(r.getAttribute('Target'));
  }

  if (by.has('word/document.xml')) {
    out.label = 'Word document';
    const docXml = await parse('word/document.xml');
    const parts = [wordText(docXml)];
    out.tracked.deleted = [...docXml.getElementsByTagName('w:delText')].map((t) => t.textContent).filter((t) => t.trim()).slice(0, 200);
    out.tracked.inserted = docXml.getElementsByTagName('w:ins').length;
    for (const name of entries.map((e) => e.name).filter((n) => /^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(n))) {
      const d = await parse(name);
      if (d) parts.push(`[${name.slice(5, -4)}]\n${wordText(d)}`);
    }
    const comments = await parse('word/comments.xml');
    if (comments) {
      const list = [...comments.getElementsByTagName('w:comment')].map((c) => `${c.getAttribute('w:author') || '?'}${c.getAttribute('w:date') ? ` (${c.getAttribute('w:date').slice(0, 10)})` : ''}: ${c.textContent.trim()}`);
      if (list.length) {
        out.meta.comments = list.length;
        parts.push(`[comments]\n${list.join('\n')}`);
      }
    }
    if (out.tracked.deleted.length) out.warnings.push(`Tracked changes keep ${out.tracked.deleted.length} deleted passage(s) that a normal view hides.`);
    out.pages.push({ n: 1, text: parts.join('\n\n'), ocr: false });
  } else if (by.has('xl/workbook.xml')) {
    out.label = 'Excel workbook';
    const shared = [];
    const ss = await parse('xl/sharedStrings.xml');
    if (ss) for (const si of ss.getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    const wb = await parse('xl/workbook.xml');
    const sheets = [...wb.getElementsByTagName('sheet')].map((s, i) => ({ name: s.getAttribute('name'), hidden: s.getAttribute('state') && s.getAttribute('state') !== 'visible', file: `xl/worksheets/sheet${i + 1}.xml` }));
    const hidden = sheets.filter((s) => s.hidden).map((s) => s.name);
    if (hidden.length) out.warnings.push(`Hidden sheets: ${hidden.join(', ')}.`);
    let n = 0;
    for (const sh of sheets) {
      const d = await parse(sh.file);
      if (!d) continue;
      const rows = [];
      for (const r of d.getElementsByTagName('row')) {
        if (rows.length >= MAX_ROWS) break;
        const row = [];
        for (const c of r.getElementsByTagName('c')) {
          const ref = c.getAttribute('r') || '';
          const col = ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
          const t = c.getAttribute('t');
          const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
          const val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? c.getElementsByTagName('t')[0]?.textContent ?? '' : v;
          if (col >= 0) row[col] = val;
          else row.push(val);
        }
        rows.push(Array.from(row, (x) => x ?? ''));
      }
      out.tables.push({ name: sh.name, hidden: !!sh.hidden, rows });
      out.pages.push({ n: ++n, label: `Sheet “${sh.name}”${sh.hidden ? ' (hidden)' : ''}`, text: rows.map((r) => r.join('\t')).join('\n'), ocr: false });
    }
  } else if (by.has('ppt/presentation.xml')) {
    out.label = 'PowerPoint presentation';
    const slides = entries.map((e) => e.name).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
    for (const [i, name] of slides.entries()) {
      const d = await parse(name);
      const notes = await parse(name.replace('slides/slide', 'notesSlides/notesSlide'));
      const body = [...d.getElementsByTagName('a:p')].map((p) => [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join('')).filter(Boolean).join('\n');
      const noteText = notes ? [...notes.getElementsByTagName('a:t')].map((t) => t.textContent).join(' ').trim() : '';
      out.pages.push({ n: i + 1, label: `Slide ${i + 1}`, text: body + (noteText ? `\n[speaker notes] ${noteText}` : ''), ocr: false });
    }
  } else if (by.has('content.xml')) {
    out.label = 'OpenDocument file';
    const meta = await parse('meta.xml');
    if (meta) Object.assign(out.meta, { title: tagText(meta, 'dc:title'), author: tagText(meta, 'dc:creator') || tagText(meta, 'meta:initial-creator'), created: tagText(meta, 'meta:creation-date'), modified: tagText(meta, 'dc:date'), application: tagText(meta, 'meta:generator') });
    const content = await parse('content.xml');
    const lines = [...content.getElementsByTagName('*')].filter((el) => ['text:p', 'text:h'].includes(el.tagName)).map((el) => el.textContent);
    out.pages.push({ n: 1, text: lines.join('\n'), ocr: false });
  } else {
    out.label = 'ZIP archive';
    out.pages.push({ n: 1, label: 'File list', text: entries.map((e) => `${e.name}  ${e.size} bytes`).join('\n'), ocr: false });
    out.meta.entries = entries.length;
  }
}

/* ---------------- Plain formats ---------------- */
/** RFC 4180 CSV (also TSV / semicolon), quoted fields and embedded newlines. */
export function parseCsv(text, maxRows = MAX_ROWS) {
  const first = text.slice(0, 2000).split('\n')[0];
  const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return { delim, rows };
}

function html(text, out) {
  const doc = new DOMParser().parseFromString(text, 'text/html'); // inert: scripts do not run, nothing loads
  doc.querySelectorAll('script, style, noscript, template, svg').forEach((el) => el.remove());
  const metaTag = (n) => doc.querySelector(`meta[name="${n}" i], meta[property="${n}" i]`)?.getAttribute('content') || null;
  Object.assign(out.meta, { title: doc.title || null, author: metaTag('author'), description: metaTag('description') || metaTag('og:description'), generator: metaTag('generator'), canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || null, language: doc.documentElement.getAttribute('lang') });
  for (const a of doc.querySelectorAll('a[href]')) if (/^https?:/i.test(a.getAttribute('href'))) out.links.add(a.getAttribute('href'));
  doc.querySelectorAll('br, p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article').forEach((el) => el.append('\n'));
  out.pages.push({ n: 1, text: (doc.body?.textContent || '').replace(/\n\s*\n+/g, '\n\n').trim(), ocr: false });
}

/** Minimal MIME reader: headers, plain-text parts (quoted-printable, base64), attachment names. */
function decodePart(headers, body) {
  const enc = /content-transfer-encoding:\s*([\w-]+)/i.exec(headers)?.[1]?.toLowerCase();
  const charset = /charset="?([\w-]+)/i.exec(headers)?.[1] || 'utf-8';
  let bytes;
  if (enc === 'base64') {
    try {
      bytes = Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    } catch {
      return body;
    }
  } else if (enc === 'quoted-printable') {
    const s = body.replace(/=\r?\n/g, '');
    const arr = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
        arr.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 2;
      } else arr.push(s.charCodeAt(i) & 0xff);
    }
    bytes = new Uint8Array(arr);
  } else return body;
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export function parseEmail(raw) {
  const split = raw.search(/\r?\n\r?\n/);
  const head = split < 0 ? raw : raw.slice(0, split);
  const body = split < 0 ? '' : raw.slice(split).replace(/^\r?\n\r?\n/, '');
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  const h = (name) => new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(unfolded)?.[1]?.trim() || null;
  const received = (unfolded.match(/^Received:/gim) || []).length;
  const parts = [];
  const attachments = [];
  const boundary = /boundary="?([^";\s]+)"?/i.exec(unfolded)?.[1];
  const walk = (headers, content, b) => {
    if (b) {
      for (const chunk of content.split(`--${b}`).slice(1)) {
        if (chunk.startsWith('--')) break;
        const s = chunk.replace(/^\r?\n/, '');
        const i = s.search(/\r?\n\r?\n/);
        const ph = i < 0 ? s : s.slice(0, i).replace(/\r?\n[ \t]+/g, ' ');
        const pb = i < 0 ? '' : s.slice(i).replace(/^\r?\n\r?\n/, '');
        walk(ph, pb, /boundary="?([^";\s]+)"?/i.exec(ph)?.[1]);
      }
      return;
    }
    const name = /(?:filename|name)="?([^";\r\n]+)"?/i.exec(headers)?.[1];
    if (/content-disposition:\s*attachment/i.test(headers) || (name && !/text\/plain/i.test(headers))) attachments.push(name || 'unnamed');
    else if (/content-type:\s*text\/plain/i.test(headers) || !/content-type:/i.test(headers)) parts.push(decodePart(headers, content));
    else if (/content-type:\s*text\/html/i.test(headers) && !parts.length) parts.push(decodePart(headers, content).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '));
  };
  walk(unfolded, body, boundary);
  return {
    headers: { from: h('From'), to: h('To'), cc: h('Cc'), subject: h('Subject'), date: h('Date'), messageId: h('Message-ID'), replyTo: h('Reply-To'), returnPath: h('Return-Path'), userAgent: h('User-Agent') || h('X-Mailer'), received },
    text: parts.join('\n\n'),
    attachments,
  };
}

async function image(file, opts, out) {
  try {
    const exifr = (await import('/vendor/exifr/full.esm.mjs')).default;
    const t = (await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, translateValues: true, reviveValues: true }).catch(() => null)) || {};
    const iso = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 19) : d ? String(d) : null);
    Object.assign(out.meta, {
      camera: [t.Make, t.Model].filter(Boolean).join(' ') || null, software: t.Software || t.CreatorTool || null, taken: iso(t.DateTimeOriginal || t.CreateDate),
      modified: iso(t.ModifyDate), author: t.Artist || t.creator || null, copyright: t.Copyright || t.rights || null,
      gps: Number.isFinite(t.latitude) && Number.isFinite(t.longitude) ? { lat: t.latitude, lon: t.longitude } : null,
    });
  } catch {
    /* no metadata */
  }
  try {
    const f = await imageForensics(file);
    out.meta.width = f.width;
    out.meta.height = f.height;
    out.media = { dhash: f.dhash, ahash: f.ahash, thumb: f.thumb };
    if (opts.ocr !== false) {
      // tesseract.js reads the encoded file itself (it cannot take an ImageBitmap).
      const r = await ocr(file, (m) => m.status === 'recognizing text' && opts.onProgress?.(`OCR: ${Math.round(m.progress * 100)}%`));
      out.pages.push({ n: 1, text: r.text, ocr: true, confidence: r.confidence });
      out.ocrPages = 1;
    }
  } catch (err) {
    out.warnings.push(`The image could not be decoded in this browser${err?.message ? ` (${err.message})` : ''}.`);
  }
}

async function video(file, opts, out) {
  out.label = out.signature.label;
  const v = await videoFrames(file, { onProgress: opts.onProgress });
  Object.assign(out.meta, { duration: v.duration, width: v.width, height: v.height, keyframes: v.frames.length });
  for (const [i, fr] of v.frames.entries()) {
    let text = '';
    let confidence;
    // Text in frames (captions, signs, screens) via OCR on each keyframe.
    if (opts.ocr !== false) {
      const r = await ocr(fr.canvas, (m) => m.status === 'recognizing text' && opts.onProgress?.(`OCR ${fr.label}: ${Math.round(m.progress * 100)}%`));
      if (r.confidence >= 50 && r.words >= 2) ({ text, confidence } = { text: r.text, confidence: r.confidence });
    }
    out.pages.push({ n: i + 1, label: fr.label, text, ocr: !!text, confidence });
    if (text) out.ocrPages++;
  }
  out.media = { frames: v.frames.map(({ canvas, ...f }) => f) };
  out.warnings.push(`Keyframes are ${v.frames.length} evenly spaced stills, not every scene change. Embedded subtitle tracks are not read; add an .srt or .vtt file to search the dialogue.`);
}

/**
 * @param {File} file
 * @param {{ ocr?: boolean, onProgress?: (text: string) => void }} [opts]
 */
export async function extractDocument(file, opts = {}) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  const signature = identify(head, file.name);
  const [sha256, sha1] = await Promise.all([digest('SHA-256', buf), digest('SHA-1', buf)]);
  const out = { kind: signature.kind, label: signature.label, signature, sha256, sha1, pages: [], meta: {}, links: new Set(), tables: [], tracked: { inserted: 0, deleted: [] }, warnings: [], ocrPages: 0, media: null };
  if (signature.warning) out.warnings.push(signature.warning);
  const ext = extOf(file.name);
  const asText = async () => cap(new TextDecoder().decode(buf.slice(0, MAX_TEXT * 2)));
  try {
    if (signature.kind === 'pdf') await pdf(buf, opts, out);
    else if (signature.kind === 'zip') await office(buf, out);
    else if (['jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp', 'heic'].includes(signature.kind)) await image(file, opts, out);
    else if (['mp4', 'mkv'].includes(signature.kind)) await video(file, opts, out);
    else if (['srt', 'vtt'].includes(ext)) {
      const cues = parseSubtitles(await asText());
      out.label = `Subtitles (${ext.toUpperCase()})`;
      out.meta.cues = cues.length;
      out.meta.duration = cues.length ? Math.round(cues.at(-1).end || cues.at(-1).start) : null;
      out.pages.push({ n: 1, text: cues.map((c) => `[${cueTime(c.start)}] ${c.text}`).join('\n'), ocr: false });
    } else if (signature.kind === 'html' || ['html', 'htm'].includes(ext)) html(await asText(), out);
    else if (signature.kind === 'eml' || ext === 'eml') {
      const m = parseEmail(await asText());
      const sent = Date.parse(m.headers.date || '');
      Object.assign(out.meta, m.headers, { attachments: m.attachments, date: Number.isFinite(sent) ? new Date(sent).toISOString() : m.headers.date, dateHeader: m.headers.date });
      out.label = 'Email message';
      out.pages.push({ n: 1, text: [m.headers.from && `From: ${m.headers.from}`, m.headers.to && `To: ${m.headers.to}`, m.headers.cc && `Cc: ${m.headers.cc}`, m.headers.subject && `Subject: ${m.headers.subject}`, m.headers.date && `Date: ${m.headers.date}`, m.attachments.length ? `Attachments: ${m.attachments.join(', ')}` : null, '', m.text].filter((x) => x !== null && x !== false).join('\n'), ocr: false });
    } else if (['csv', 'tsv'].includes(ext)) {
      const t = await asText();
      const { rows } = parseCsv(t);
      out.label = 'CSV table';
      out.tables.push({ name: file.name, rows });
      out.pages.push({ n: 1, text: rows.map((r) => r.join('\t')).join('\n'), ocr: false });
    } else if (signature.kind === 'json' || ['json', 'geojson'].includes(ext)) {
      const t = await asText();
      try {
        out.pages.push({ n: 1, text: JSON.stringify(JSON.parse(t), null, 1), ocr: false });
        out.label = 'JSON data';
      } catch {
        out.pages.push({ n: 1, text: t, ocr: false });
        out.warnings.push('Not valid JSON; read as plain text.');
      }
    } else if (signature.kind === 'xml') {
      const t = await asText();
      const d = xml(t);
      out.meta.rootElement = d.documentElement?.tagName || null;
      out.pages.push({ n: 1, text: (d.documentElement?.textContent || t).replace(/\n\s*\n+/g, '\n'), ocr: false });
    } else if (signature.kind === 'text' || ['txt', 'md', 'log'].includes(ext)) {
      out.pages.push({ n: 1, text: await asText(), ocr: false });
    } else {
      out.warnings.push(`${signature.label}: no text extraction for this format. Hashes and signature are recorded.`);
    }
  } catch (err) {
    out.warnings.push(`Extraction stopped: ${err?.message || err}`);
  }
  if (out.meta.created && out.meta.modified && String(out.meta.modified).slice(0, 19) < String(out.meta.created).slice(0, 19)) out.warnings.push(`Modified (${out.meta.modified}) is earlier than created (${out.meta.created}): edited metadata, or a conversion tool reset the dates.`);
  for (const m of out.pages.map((p) => p.text).join('\n').matchAll(/\bhttps?:\/\/[^\s<>"'()\]]{4,300}/gi)) out.links.add(m[0].replace(/[.,;:]+$/, ''));
  out.text = cap(out.pages.map((p) => p.text).join('\n\f\n'));
  out.links = [...out.links].slice(0, 2000);
  return out;
}
