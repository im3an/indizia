// Lazy loading of vendored libraries, so the first page load stays small.
const loaded = new Map();

/** Load a classic (UMD) script once. */
export function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Could not load ${src}`));
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src);
}

/** Load a stylesheet once. */
export function loadStyle(href) {
  if (!loaded.has(href)) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
    loaded.set(href, Promise.resolve());
  }
  return loaded.get(href);
}
