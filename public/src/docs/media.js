// Media forensics on the user's device: perceptual hashes (dHash, aHash) for images and video keyframes,
// keyframe extraction from videos the browser can decode, and subtitle files (SRT, WebVTT) as timed text.
// Perceptual hashes find the same picture after resizing, recompression or small edits; they are a lead,
// not proof of identity. Originals stay untouched; every derived item is recorded in the document history.

/** 64-bit difference hash from a 9×8 grayscale grid (row-major, 72 values). Returns 16 hex characters. */
export function dhashFromGray(gray) {
  let hi = 0;
  let lo = 0;
  let bit = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const on = gray[y * 9 + x] > gray[y * 9 + x + 1];
      if (on) {
        if (bit < 32) lo |= 1 << bit;
        else hi |= 1 << (bit - 32);
      }
      bit++;
    }
  }
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

/** 64-bit average hash from an 8×8 grayscale grid. */
export function ahashFromGray(gray) {
  const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
  let hi = 0;
  let lo = 0;
  gray.forEach((v, i) => {
    if (v > mean) {
      if (i < 32) lo |= 1 << i;
      else hi |= 1 << (i - 32);
    }
  });
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

function grid(source, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return out;
}

/** Perceptual hashes of a drawable (ImageBitmap, video element, canvas). */
export function hashes(source) {
  return { dhash: dhashFromGray(grid(source, 9, 8)), ahash: ahashFromGray(grid(source, 8, 8)) };
}

function thumb(source, w, h, max = 200) {
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/jpeg', 0.72), canvas: c };
}

export async function imageForensics(file) {
  const bmp = await createImageBitmap(file);
  try {
    return { ...hashes(bmp), width: bmp.width, height: bmp.height, thumb: thumb(bmp, bmp.width, bmp.height).dataUrl };
  } finally {
    bmp.close();
  }
}

const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * Keyframes at even intervals from a video the browser can decode (MP4/H.264, WebM/VP9, …).
 * @returns {Promise<{ duration, width, height, frames: { t, label, dhash, ahash, thumb, canvas }[] }>}
 */
export async function videoFrames(file, { count = 8, onProgress } = {}) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.playsInline = true;
  v.src = url;
  try {
    await new Promise((resolve, reject) => {
      v.onloadedmetadata = resolve;
      v.onerror = () => reject(new Error('this browser cannot decode the video'));
      setTimeout(() => reject(new Error('the video did not load in time')), 15000);
    });
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    const n = duration > 0 ? Math.min(count, Math.max(1, Math.ceil(duration / 2))) : 1;
    const frames = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (duration * (i + 0.5)) / n;
      await new Promise((resolve, reject) => {
        v.onseeked = resolve;
        v.onerror = () => reject(new Error('seek failed'));
        v.currentTime = t;
      });
      onProgress?.(`Keyframe ${i + 1} of ${n} at ${fmtT(t)}`);
      const th = thumb(v, v.videoWidth, v.videoHeight, 640);
      frames.push({ t: Math.round(t * 10) / 10, label: `Frame at ${fmtT(t)}`, ...hashes(v), thumb: thumb(v, v.videoWidth, v.videoHeight).dataUrl, canvas: th.canvas });
    }
    return { duration: Math.round(duration * 10) / 10, width: v.videoWidth, height: v.videoHeight, frames };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

/** SRT or WebVTT → cues { start, end, text } (seconds). */
export function parseSubtitles(text) {
  const toSec = (s) => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s);
    return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000 : null;
  };
  const cues = [];
  for (const block of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() && !/^WEBVTT/.test(l) && !/^NOTE\b/.test(l));
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = toSec(a);
    const end = toSec(b);
    const body = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (start !== null && body) cues.push({ start, end, text: body });
  }
  return cues;
}

export const cueTime = fmtT;
