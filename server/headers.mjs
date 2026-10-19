// Security headers shared by the Node server. The Worker deployment uses public/_headers with the same values.
export const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'", // WebAssembly only (OCR); JavaScript eval stays blocked
    "style-src 'self' 'unsafe-inline'", // Leaflet positions map tiles with inline styles
    "font-src 'self'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://tiles.maps.eox.at https://*.tile.opentopomap.org https://tile.opentopomap.org",
    "connect-src 'self' https:", // RDAP servers come from the IANA bootstrap, so any HTTPS origin may be needed
    "worker-src 'self' blob:",
    "media-src 'self' blob:", // local video keyframes (documents are never uploaded)
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
