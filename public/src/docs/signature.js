// File signatures ("magic numbers"): what a file really is, whatever its name says. Pure, used by the
// document workspace and media forensics. Offsets and bytes from the formats' specifications.

const SIGS = [
  // [kind, label, test(bytes), extensions that agree]
  ['pdf', 'PDF document', (b) => ascii(b, '%PDF'), ['pdf']],
  ['zip', 'ZIP container (Office Open XML, OpenDocument, JAR, plain ZIP)', (b) => ascii(b, 'PK\x03\x04'), ['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'jar', 'apk']],
  ['ole', 'OLE compound file (legacy .doc/.xls/.ppt/.msg)', (b) => hex(b, 'd0cf11e0a1b11ae1'), ['doc', 'xls', 'ppt', 'msg']],
  ['rtf', 'Rich Text Format', (b) => ascii(b, '{\\rtf'), ['rtf']],
  ['jpeg', 'JPEG image', (b) => hex(b, 'ffd8ff'), ['jpg', 'jpeg', 'jfif']],
  ['png', 'PNG image', (b) => hex(b, '89504e470d0a1a0a'), ['png']],
  ['gif', 'GIF image', (b) => ascii(b, 'GIF87a') || ascii(b, 'GIF89a'), ['gif']],
  ['webp', 'WebP image', (b) => ascii(b, 'RIFF') && ascii(b, 'WEBP', 8), ['webp']],
  ['heic', 'HEIF/HEIC image', (b) => ascii(b, 'ftyp', 4) && /^(heic|heix|hevc|mif1|msf1|avif)/.test(str(b, 8, 4)), ['heic', 'heif', 'avif']],
  ['tiff', 'TIFF image (also many camera RAW formats)', (b) => hex(b, '49492a00') || hex(b, '4d4d002a'), ['tif', 'tiff', 'dng', 'nef', 'cr2', 'arw']],
  ['bmp', 'BMP image', (b) => ascii(b, 'BM'), ['bmp']],
  ['svg', 'SVG image (XML)', (b) => /<svg[\s>]/i.test(str(b, 0, 512)), ['svg']],
  ['mp4', 'MP4 / QuickTime video', (b) => ascii(b, 'ftyp', 4) && /^(isom|iso2|mp41|mp42|avc1|qt  |M4V |M4A |3gp|dash|mmp4)/.test(str(b, 8, 4)), ['mp4', 'm4v', 'mov', 'm4a', '3gp']],
  ['mkv', 'Matroska / WebM video', (b) => hex(b, '1a45dfa3'), ['mkv', 'webm', 'mka']],
  ['avi', 'AVI video', (b) => ascii(b, 'RIFF') && ascii(b, 'AVI ', 8), ['avi']],
  ['wav', 'WAV audio', (b) => ascii(b, 'RIFF') && ascii(b, 'WAVE', 8), ['wav']],
  ['mp3', 'MP3 audio', (b) => ascii(b, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0), ['mp3']],
  ['ogg', 'Ogg media', (b) => ascii(b, 'OggS'), ['ogg', 'oga', 'ogv', 'opus']],
  ['flac', 'FLAC audio', (b) => ascii(b, 'fLaC'), ['flac']],
  ['gzip', 'gzip archive', (b) => hex(b, '1f8b'), ['gz', 'tgz']],
  ['7z', '7-Zip archive', (b) => hex(b, '377abcaf271c'), ['7z']],
  ['rar', 'RAR archive', (b) => ascii(b, 'Rar!\x1a\x07'), ['rar']],
  ['xz', 'xz archive', (b) => hex(b, 'fd377a585a00'), ['xz']],
  ['bz2', 'bzip2 archive', (b) => ascii(b, 'BZh'), ['bz2']],
  ['sqlite', 'SQLite database', (b) => ascii(b, 'SQLite format 3\x00'), ['sqlite', 'db', 'sqlite3']],
  ['exe', 'Windows executable (PE)', (b) => ascii(b, 'MZ'), ['exe', 'dll', 'sys', 'scr']],
  ['elf', 'Linux executable (ELF)', (b) => hex(b, '7f454c46'), ['so', 'bin', 'elf']],
  ['macho', 'macOS executable (Mach-O)', (b) => ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].some((h) => hex(b, h)), ['dylib', 'app']],
  ['eml', 'Email message (RFC 5322)', (b) => /^(Return-Path|Received|From|Delivered-To|MIME-Version|Message-ID|X-[\w-]+):/im.test(str(b, 0, 1024)), ['eml']],
  ['html', 'HTML document', (b) => /^\s*(<!doctype html|<html|<head|<body)/i.test(str(b, 0, 512)), ['html', 'htm', 'xhtml']],
  ['xml', 'XML document', (b) => /^\s*<\?xml/.test(str(b, 0, 64)), ['xml', 'rss', 'atom', 'kml', 'gpx', 'xsd', 'svg']],
  ['json', 'JSON data', (b) => /^\s*[[{]/.test(str(b, 0, 16)), ['json', 'geojson', 'jsonl', 'ndjson']],
];

const TEXT_EXT = new Set(['txt', 'md', 'csv', 'tsv', 'log', 'ini', 'yaml', 'yml']);
const EXECUTABLE = new Set(['exe', 'elf', 'macho']);

function ascii(b, s, at = 0) {
  if (b.length < at + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
}
function hex(b, h) {
  for (let i = 0; i < h.length / 2; i++) if (b[i] !== parseInt(h.slice(i * 2, i * 2 + 2), 16)) return false;
  return true;
}
function str(b, at, len) {
  let s = '';
  for (let i = at; i < Math.min(b.length, at + len); i++) s += String.fromCharCode(b[i]);
  return s;
}
function looksText(b) {
  let bad = 0;
  const n = Math.min(b.length, 2048);
  for (let i = 0; i < n; i++) if (b[i] === 0 || (b[i] < 9 && b[i] !== 0)) bad++;
  return n > 0 && bad / n < 0.01;
}

export const extOf = (name) => (/\.([a-z0-9]{1,8})$/i.exec(name || '')?.[1] || '').toLowerCase();

/**
 * @param {Uint8Array} bytes first ≥ 64 bytes of the file
 * @param {string} name file name
 * @returns {{ kind: string, label: string, ext: string, matches: boolean, executable: boolean, warning: string|null }}
 */
export function identify(bytes, name) {
  const ext = extOf(name);
  const hit = SIGS.find(([, , test]) => test(bytes));
  if (!hit) {
    const text = looksText(bytes);
    const kind = text ? 'text' : 'unknown';
    return { kind, label: text ? 'Plain text' : 'Unknown binary format', ext, matches: text ? TEXT_EXT.has(ext) || !ext : false, executable: false, warning: null };
  }
  const [kind, label, , exts] = hit;
  const matches = !ext || exts.includes(ext) || (kind === 'json' && TEXT_EXT.has(ext)) || (kind === 'xml' && ['html', 'htm'].includes(ext));
  const executable = EXECUTABLE.has(kind);
  let warning = null;
  if (executable && ext && !exts.includes(ext)) warning = `The name ends in .${ext}, but the content is a ${label}. A classic disguise for malware: do not open it.`;
  else if (!matches && ext) warning = `The name ends in .${ext}, but the content is a ${label}.`;
  return { kind, label, ext, matches, executable, warning };
}
