// File analysis on the user's device. Files are never uploaded.

import { listEntries, readEntry } from '../zip.js';

const URL_RE = /\bhttps?:\/\/[^\s<>"'()\]]{4,300}/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi;
const MAX_PDF_PAGES = 60;
const MAX_TEXT = 400_000;

function sniff(bytes, name) {
  const b = (i) => bytes[i];
  const ascii = (s, at = 0) => [...s].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (ascii('%PDF')) return { kind: 'pdf', mime: 'application/pdf' };
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (ascii('\x89PNG')) return { kind: 'image', mime: 'image/png' };
  if (ascii('GIF8')) return { kind: 'image', mime: 'image/gif' };
  if (ascii('RIFF') && ascii('WEBP', 8)) return { kind: 'image', mime: 'image/webp' };
  if (ascii('ftyp', 4) && (ascii('heic', 8) || ascii('heix', 8) || ascii('mif1', 8))) return { kind: 'image', mime: 'image/heic' };
  if ((b(0) === 0x49 && b(1) === 0x49) || (b(0) === 0x4d && b(1) === 0x4d)) return { kind: 'image', mime: 'image/tiff' };
  if (ascii('PK\x03\x04')) return { kind: 'zip', mime: /\.(docx|xlsx|pptx)$/i.test(name) ? 'Office Open XML (ZIP container)' : /\.od[tsp]$/i.test(name) ? 'OpenDocument (ZIP container)' : 'application/zip' };
  if (ascii('MZ')) return { kind: 'binary', mime: 'application/x-msdownload (Windows executable)' };
  if (ascii('\x7fELF')) return { kind: 'binary', mime: 'application/x-elf (Linux executable)' };
  if (/\.(txt|csv|md|html?|xml|json|eml|log)$/i.test(name)) return { kind: 'text', mime: 'text/plain' };
  return { kind: 'unknown', mime: 'unknown' };
}

async function digest(algo, buf) {
  const d = await crypto.subtle.digest(algo, buf);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function domainsFrom(urls) {
  const hosts = new Map();
  for (const u of urls) {
    try {
      const h = new URL(u).hostname.replace(/^www\./, '').toLowerCase();
      if (h.includes('.')) hosts.set(h, (hosts.get(h) || 0) + 1);
    } catch {
      /* not a URL */
    }
  }
  return [...hosts.entries()].sort((a, b) => b[1] - a[1]);
}

function pdfDate(s) {
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s || '');
  if (!m) return s || null;
  return `${m[1]}-${m[2] || '01'}-${m[3] || '01'}${m[4] ? ` ${m[4]}:${m[5] || '00'}` : ''}`;
}

function reportLinks(ctx, urls, emails, evidence, where) {
  const domains = domainsFrom(urls);
  if (domains.length) {
    ctx.finding({
      title: `Links to ${domains.length} domains${where ? ` (${where})` : ''}`,
      detail: `${urls.length} URLs in total. Most frequent: ${domains.slice(0, 4).map(([d, n]) => `${d} (${n})`).join(', ')}.`,
      confidence: 'confirmed',
      evidence,
      links: domains.slice(0, 40).map(([d, n]) => ({ href: `https://${d}`, label: d, meta: `${n}×`, q: d })),
    });
    for (const [d] of domains.slice(0, 12)) ctx.relate(ctx.entity, { type: 'domain', value: d }, 'links to');
  }
  if (emails.size) ctx.fact('Content', { label: 'Email addresses', value: `${emails.size} in the text (not looked up)`, evidence });
}

async function analysePdf(ctx, buf) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  // isEvalSupported:false and no scripting: document JavaScript is detected, never executed.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false, enableXfa: false, disableFontFace: true, stopAtErrors: false, verbosity: 0 }).promise;
  const meta = await doc.getMetadata().catch(() => ({ info: {} }));
  const info = meta.info || {};
  const xmp = meta.metadata?.getAll?.() || {};
  const urls = [];
  const emails = new Set();
  let text = '';
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    for (const a of await page.getAnnotations()) if (a.url) urls.push(a.url);
    if (text.length < MAX_TEXT) {
      const tc = await page.getTextContent();
      text += tc.items.map((it) => it.str).join(' ') + '\n';
    }
  }
  for (const m of text.match(URL_RE) || []) urls.push(m.replace(/[.,;]+$/, ''));
  for (const m of text.match(EMAIL_RE) || []) emails.add(m.toLowerCase());
  const js = await doc.getJSActions().catch(() => null);
  const attachments = await doc.getAttachments().catch(() => null);
  const docMeta = {
    title: info.Title || xmp['dc:title'], author: info.Author || xmp['dc:creator'], subject: info.Subject, keywords: info.Keywords,
    creator: info.Creator || xmp['xmp:creatortool'], producer: info.Producer || xmp['pdf:producer'],
    created: pdfDate(info.CreationDate) || xmp['xmp:createdate'], modified: pdfDate(info.ModDate) || xmp['xmp:modifydate'],
    version: info.PDFFormatVersion, pages: doc.numPages, encrypted: !!info.EncryptFilterName, forms: !!info.IsAcroFormPresent, xfa: !!info.IsXFAPresent,
    javascript: !!(js && Object.keys(js).length), attachments: attachments ? Object.keys(attachments).length : 0, textChars: text.length,
  };
  const evidence = ctx.local('pdf.js', { ...docMeta, xmp });

  const g = 'Document';
  if (docMeta.title) ctx.fact(g, { label: 'Title', value: docMeta.title, evidence });
  ctx.fact(g, { label: 'Author', value: docMeta.author || 'not set', evidence, muted: !docMeta.author });
  if (docMeta.creator) ctx.fact(g, { label: 'Created with', value: docMeta.creator, evidence });
  if (docMeta.producer) ctx.fact(g, { label: 'Producer', value: docMeta.producer, evidence });
  if (docMeta.created) ctx.fact(g, { label: 'Created', value: docMeta.created, evidence, date: docMeta.created });
  if (docMeta.modified) ctx.fact(g, { label: 'Modified', value: docMeta.modified, evidence });
  ctx.fact(g, { label: 'Pages', value: `${docMeta.pages}${doc.numPages > MAX_PDF_PAGES ? ` (first ${MAX_PDF_PAGES} scanned)` : ''} · PDF ${docMeta.version || '?'}`, evidence });
  ctx.fact('Content', { label: 'Text', value: docMeta.textChars ? `${docMeta.textChars.toLocaleString()} characters` : 'No text layer (scanned image?)', evidence, muted: !docMeta.textChars });

  ctx.finding({
    title: `PDF${docMeta.title ? ` “${docMeta.title}”` : ''}${docMeta.author ? ` by ${docMeta.author}` : ''}`,
    detail: [docMeta.creator && `made with ${docMeta.creator}`, docMeta.producer && `produced by ${docMeta.producer}`, docMeta.created && `created ${docMeta.created}`, docMeta.modified && docMeta.modified !== docMeta.created && `modified ${docMeta.modified}`].filter(Boolean).join(' · ') || 'No document metadata set.',
    confidence: 'confirmed',
    confidenceNote: 'Embedded metadata can be edited by anyone; treat it as a claim made by the file',
    evidence,
    date: docMeta.created,
  });
  if (docMeta.created && docMeta.modified && docMeta.modified < docMeta.created) {
    ctx.finding({ title: 'Modified date is earlier than the creation date', detail: 'A sign of edited metadata or a conversion tool resetting dates.', confidence: 'conflict', evidence });
  }
  const risks = [docMeta.javascript && 'embedded JavaScript (not executed)', docMeta.attachments && `${docMeta.attachments} embedded files`, docMeta.xfa && 'XFA forms', docMeta.encrypted && 'encryption'].filter(Boolean);
  if (risks.length) ctx.finding({ title: `Active or hidden content: ${risks.join(', ')}`, detail: 'Worth checking before opening the file in a regular PDF reader.', confidence: 'conflict', evidence });
  reportLinks(ctx, urls, emails, evidence, 'link annotations and text');
  if (docMeta.author) ctx.relate(ctx.entity, { type: 'person-name', value: docMeta.author, label: `Author: ${docMeta.author}` }, 'author field');
}

async function analyseImage(ctx, file) {
  const exifr = (await import('/vendor/exifr/full.esm.mjs')).default;
  const tags = (await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, translateValues: true, reviveValues: true }).catch(() => null)) || {};
  let dims = null;
  try {
    const bmp = await createImageBitmap(file);
    dims = `${bmp.width} × ${bmp.height}`;
    bmp.close();
  } catch {
    /* format not decodable in this browser */
  }
  const iso = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().replace('T', ' ').slice(0, 19) : d ? String(d) : null);
  const m = {
    camera: [tags.Make, tags.Model].filter(Boolean).join(' '), lens: tags.LensModel, software: tags.Software || tags.CreatorTool,
    taken: iso(tags.DateTimeOriginal || tags.CreateDate), modified: iso(tags.ModifyDate), artist: tags.Artist || tags.creator || tags.Creator,
    copyright: tags.Copyright || tags.rights, lat: tags.latitude, lon: tags.longitude, altitude: tags.GPSAltitude, dims,
  };
  const evidence = ctx.local('exifr', Object.fromEntries(Object.entries(tags).filter(([, v]) => typeof v !== 'object' || v instanceof Date).slice(0, 120)));
  const g = 'Image';
  if (dims) ctx.fact(g, { label: 'Dimensions', value: dims, evidence });
  if (m.camera) ctx.fact(g, { label: 'Camera', value: m.camera, evidence });
  if (m.lens) ctx.fact(g, { label: 'Lens', value: m.lens, evidence });
  if (m.software) ctx.fact(g, { label: 'Software', value: m.software, evidence });
  if (m.taken) ctx.fact(g, { label: 'Taken', value: m.taken, evidence, date: m.taken });
  if (m.modified && m.modified !== m.taken) ctx.fact(g, { label: 'Modified', value: m.modified, evidence });
  if (m.artist) ctx.fact(g, { label: 'Artist / creator', value: String(m.artist), evidence });
  if (m.copyright) ctx.fact(g, { label: 'Copyright', value: String(m.copyright), evidence });
  const keys = Object.keys(tags).length;
  ctx.finding({
    title: keys ? `${keys} metadata fields${m.camera ? ` · ${m.camera}` : ''}${m.taken ? ` · taken ${m.taken}` : ''}` : 'No embedded metadata (often stripped by social networks and messengers)',
    detail: m.software ? `Last processed with ${m.software}.` : undefined,
    confidence: keys ? 'confirmed' : 'lead',
    confidenceNote: 'EXIF can be edited; treat it as a claim made by the file',
    evidence,
    date: m.taken,
  });
  if (Number.isFinite(m.lat) && Number.isFinite(m.lon)) {
    const coord = `${m.lat.toFixed(6)}, ${m.lon.toFixed(6)}`;
    ctx.fact(g, { label: 'GPS', value: `${coord}${m.altitude ? ` · ${Math.round(m.altitude)} m` : ''}`, evidence, mono: true });
    ctx.geo({ lat: m.lat, lon: m.lon, label: `${ctx.entity.value} (EXIF GPS)`, precision: 'exact', kind: 'file' });
    ctx.finding({
      title: `Embedded GPS position: ${coord}`,
      detail: 'Shows where the camera says the photo was taken. If this image shows a private person, treat the location as sensitive.',
      confidence: 'plausible',
      evidence,
      pivots: [{ type: 'coordinates', value: coord }],
    });
  }
}

function xmlText(doc, tag) {
  const el = doc.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() || null;
}

async function analyseOffice(ctx, buf) {
  const entries = listEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const parse = async (name) => (byName.has(name) ? new DOMParser().parseFromString(await readEntry(buf, byName.get(name)), 'application/xml') : null);
  const kind = byName.has('word/document.xml') ? 'Word document' : byName.has('xl/workbook.xml') ? 'Excel workbook' : byName.has('ppt/presentation.xml') ? 'PowerPoint presentation' : byName.has('content.xml') ? 'OpenDocument file' : 'ZIP archive';
  const core = await parse('docProps/core.xml');
  const app = await parse('docProps/app.xml');
  const meta = {
    kind,
    title: core && xmlText(core, 'dc:title'), creator: core && xmlText(core, 'dc:creator'), lastModifiedBy: core && xmlText(core, 'cp:lastModifiedBy'),
    created: core && xmlText(core, 'dcterms:created'), modified: core && xmlText(core, 'dcterms:modified'), revision: core && xmlText(core, 'cp:revision'),
    application: app && xmlText(app, 'Application'), appVersion: app && xmlText(app, 'AppVersion'), company: app && xmlText(app, 'Company'),
    template: app && xmlText(app, 'Template'), editMinutes: app && xmlText(app, 'TotalTime'), files: entries.length,
    media: entries.filter((e) => /\/media\//.test(e.name)).length, comments: entries.some((e) => /comments\d*\.xml$/.test(e.name)), macros: entries.some((e) => /vbaProject\.bin$/i.test(e.name)),
  };
  const urls = [];
  for (const e of entries.filter((x) => x.name.endsWith('.rels'))) {
    const rels = new DOMParser().parseFromString(await readEntry(buf, e), 'application/xml');
    for (const r of rels.getElementsByTagName('Relationship')) if (r.getAttribute('TargetMode') === 'External' && /^https?:/i.test(r.getAttribute('Target') || '')) urls.push(r.getAttribute('Target'));
  }
  const evidence = ctx.local('office-zip', meta);
  const g = 'Document';
  ctx.fact(g, { label: 'Type', value: kind, evidence });
  if (meta.title) ctx.fact(g, { label: 'Title', value: meta.title, evidence });
  ctx.fact(g, { label: 'Author', value: meta.creator || 'not set', evidence, muted: !meta.creator });
  if (meta.lastModifiedBy) ctx.fact(g, { label: 'Last saved by', value: meta.lastModifiedBy, evidence });
  if (meta.company) ctx.fact(g, { label: 'Company field', value: meta.company, evidence });
  if (meta.application) ctx.fact(g, { label: 'Application', value: `${meta.application}${meta.appVersion ? ` ${meta.appVersion}` : ''}`, evidence });
  if (meta.template) ctx.fact(g, { label: 'Template', value: meta.template, evidence });
  if (meta.created) ctx.fact(g, { label: 'Created', value: meta.created.replace('T', ' ').replace('Z', ''), evidence, date: meta.created });
  if (meta.modified) ctx.fact(g, { label: 'Modified', value: meta.modified.replace('T', ' ').replace('Z', ''), evidence });
  if (meta.revision) ctx.fact(g, { label: 'Revision', value: `${meta.revision}${meta.editMinutes ? ` · ${meta.editMinutes} min editing` : ''}`, evidence });
  ctx.finding({
    title: `${kind}${meta.creator ? ` by ${meta.creator}` : ''}${meta.company ? ` · company field “${meta.company}”` : ''}`,
    detail: [meta.lastModifiedBy && `last saved by ${meta.lastModifiedBy}`, meta.application && `made with ${meta.application}`, `${meta.media} embedded media files`, meta.comments && 'contains comments'].filter(Boolean).join(' · '),
    confidence: 'confirmed',
    confidenceNote: 'Document properties can be edited; treat them as claims made by the file',
    evidence,
    date: meta.created,
    pivots: meta.company ? [{ type: 'organisation', value: meta.company }] : [],
  });
  if (meta.macros) ctx.finding({ title: 'Contains VBA macros', detail: 'Macros can run code when the file is opened in Office.', confidence: 'conflict', evidence });
  if (meta.company) ctx.relate(ctx.entity, { type: 'organisation', value: meta.company }, 'company field');
  reportLinks(ctx, urls, new Set(), evidence, 'hyperlinks');
}

async function analyseText(ctx, file) {
  const text = (await file.slice(0, MAX_TEXT).text()) || '';
  const urls = (text.match(URL_RE) || []).map((u) => u.replace(/[.,;]+$/, ''));
  const emails = new Set((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase()));
  const evidence = ctx.local('text', { chars: text.length, urls: urls.length, emails: emails.size });
  ctx.fact('Content', { label: 'Text', value: `${text.length.toLocaleString()} characters scanned`, evidence });
  reportLinks(ctx, urls, emails, evidence, 'text');
}

export const fileAnalysis = {
  id: 'file-local',
  name: 'Local file analysis',
  provider: 'pdf.js · exifr · built-in ZIP reader, on your device',
  homepage: 'https://mozilla.github.io/pdf.js/',
  terms: '',
  licence: 'The file never leaves this browser',
  category: 'Files',
  accepts: ['file'],
  cors: true,
  local: true,

  async run(ctx) {
    const file = ctx.entity.file;
    if (!file) throw new Error('No file attached');
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(16, buf.byteLength));
    const type = sniff(head, file.name);
    const [sha256, sha1] = await Promise.all([digest('SHA-256', buf), digest('SHA-1', buf)]);
    const evidence = ctx.local('file', { name: file.name, size: file.size, declaredType: file.type, detected: type.mime, sha256, sha1, lastModified: new Date(file.lastModified).toISOString() });
    ctx.fact('File', { label: 'Name', value: file.name, evidence });
    ctx.fact('File', { label: 'Size', value: `${file.size.toLocaleString()} bytes`, evidence });
    ctx.fact('File', { label: 'Detected type', value: type.mime + (file.type && file.type !== type.mime && type.kind !== 'unknown' ? ` (browser says ${file.type})` : ''), evidence });
    ctx.fact('File', { label: 'SHA-256', value: sha256, evidence, mono: true });
    ctx.fact('File', { label: 'SHA-1', value: sha1, evidence, mono: true });
    ctx.finding({
      title: `${type.mime} · ${(file.size / 1024).toFixed(1)} KB · SHA-256 ${sha256.slice(0, 16)}…`,
      detail: 'Analysed in your browser. The file was not uploaded anywhere.',
      confidence: 'confirmed',
      evidence,
      pivots: [{ type: 'hash', value: sha256 }],
    });
    if (/\.(pdf|jpe?g|png|docx?|xlsx?|pptx?)$/i.test(file.name) && type.kind === 'binary') {
      ctx.finding({ title: `Extension says ${file.name.split('.').pop()}, content is an executable`, detail: 'A classic disguise for malware. Do not open it.', confidence: 'conflict', evidence });
    }
    if (type.kind === 'pdf') await analysePdf(ctx, buf);
    else if (type.kind === 'image') await analyseImage(ctx, file);
    else if (type.kind === 'zip') await analyseOffice(ctx, buf);
    else if (type.kind === 'text') await analyseText(ctx, file);
  },
};
