// OCR with tesseract.js in a Web Worker: the image never leaves the browser. Self-hosted engine and compact
// English + German models (public/vendor/tesseract). One worker is reused for a batch and closed when idle.

let worker = null;
let idleTimer = null;
let queue = Promise.resolve();
let current = null; // progress callback of the job being recognised

async function getWorker(onProgress) {
  clearTimeout(idleTimer);
  if (!worker) {
    const T = await import('/vendor/tesseract/tesseract.esm.min.js');
    const createWorker = T.createWorker || T.default?.createWorker;
    worker = createWorker('eng+deu', 1, {
      workerPath: '/vendor/tesseract/worker.min.js',
      corePath: '/vendor/tesseract/core',
      langPath: '/vendor/tesseract/lang',
      gzip: true,
      workerBlobURL: false,
      cacheMethod: 'none', // models are served from this origin with long cache headers already
      logger: (m) => current?.(m),
    });
  }
  current = onProgress;
  return worker;
}

/**
 * Recognise text in an image (Blob, canvas or ImageBitmap). Calls are queued, one at a time.
 * @returns {Promise<{ text: string, confidence: number, words: number }>}
 */
export function ocr(image, onProgress) {
  const job = queue.then(async () => {
    const w = await getWorker(onProgress);
    const { data } = await w.recognize(image);
    idleTimer = setTimeout(closeOcr, 60_000);
    return { text: data.text || '', confidence: Math.round(data.confidence || 0), words: (data.text || '').split(/\s+/).filter(Boolean).length };
  });
  queue = job.catch(() => {});
  return job;
}

export async function closeOcr() {
  clearTimeout(idleTimer);
  const w = worker;
  worker = null;
  if (w) await (await w).terminate().catch(() => {});
}
