// Download page: picks the build for this visitor's system from data/desktop.json. Releases live on GitHub
// (Workers assets are limited to 25 MB per file); fixed file names make /releases/latest/download/ work.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function detect() {
  const ua = navigator.userAgent;
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const os = /mac/i.test(platform) || /Mac OS X/.test(ua) ? 'mac' : /win/i.test(platform) || /Windows/.test(ua) ? 'win' : /linux/i.test(platform) && !/Android/.test(ua) ? 'linux' : null;
  let arch = 'arm64';
  if (os === 'mac') {
    try {
      const hints = await navigator.userAgentData?.getHighEntropyValues(['architecture']);
      if (hints?.architecture === 'x86') arch = 'x64';
    } catch {
      /* Safari and Firefox do not say; Apple silicon is the likely case */
    }
  }
  return os === 'mac' ? `mac-${arch}` : os === 'win' ? 'win-x64' : os === 'linux' ? 'linux-x64' : null;
}

async function main() {
  let info;
  try {
    info = await (await fetch('/data/desktop.json', { cache: 'no-cache' })).json();
  } catch {
    return;
  }
  $('dl-version').textContent = info.version;
  const href = (a) => (info.repo ? `https://github.com/${info.repo}/releases/latest/download/${a.file}` : '#build');
  const mine = await detect();
  const main = info.assets[mine] || null;
  const btn = $('dl-main');
  if (main) {
    btn.textContent = `Download for ${main.label}`;
    btn.href = href(main);
  } else {
    btn.textContent = 'Choose your system below';
    btn.href = '#dl-other';
  }
  if (!info.repo) {
    $('dl-unpublished').hidden = false;
    btn.textContent = main ? `Build for ${main.label}` : 'Build it yourself';
  } else {
    btn.classList.add('primary');
    $('dl-meta').innerHTML = `Version ${esc(info.version)} · <a href="https://github.com/${esc(info.repo)}/releases/latest" target="_blank" rel="noopener noreferrer">release notes and checksums</a>`;
  }
  $('dl-other').innerHTML = Object.entries(info.assets)
    .filter(([id]) => id !== mine)
    .map(([, a]) => `<li><a href="${esc(href(a))}">${esc(a.label)}</a> <span class="mono">${esc(a.file)}</span></li>`)
    .join('');
}

main();
