// Docker CLI wrapper for the local toolbox and the desktop engine container. Arguments are always an
// array (no shell). Every container Indizia starts is labelled, read-only, unprivileged, resource-capped
// and removed when it exits, so a run leaves nothing behind except the pulled image.
import { execFile, spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, dirname } from 'node:path';
import { homedir } from 'node:os';

export const LABEL = 'app.indizia';

/** Flags shared by every container Indizia runs. */
export const HARDENING = [
  '--read-only',
  '--tmpfs', '/tmp:rw,nosuid,size=128m',
  '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges',
  '--pids-limit', '256',
  '--label', `${LABEL}=1`,
];

// Apps started from Finder or the Start menu get a minimal PATH, so look in the usual install places too.
const CANDIDATES = process.platform === 'win32'
  ? ['docker.exe', 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe']
  : ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', `${homedir()}/.orbstack/bin/docker`, `${homedir()}/.rd/bin/docker`, '/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/bin/docker', '/snap/bin/docker'];

let resolved;
async function dockerBinary() {
  if (resolved !== undefined) return resolved;
  resolved = null;
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) CANDIDATES.unshift(`${dir}/docker${process.platform === 'win32' ? '.exe' : ''}`);
  for (const c of CANDIDATES) {
    try {
      await access(c, constants.X_OK);
      resolved = c;
      break;
    } catch {
      /* not here */
    }
  }
  return resolved;
}

/** PATH for the CLI: its own directory first, so credential helpers next to it are found. */
function env(bin) {
  const extra = [dirname(bin), '/usr/local/bin', '/opt/homebrew/bin'];
  return { ...process.env, PATH: [...extra, process.env.PATH || ''].join(delimiter) };
}

/**
 * Run the Docker CLI. Resolves with { code, stdout, stderr, ms, timedOut, truncated }; never rejects for a
 * non-zero exit. `name` lets a timeout kill the container, not just the CLI process.
 */
export async function docker(args, { input, timeoutMs = 60_000, maxBytes = 16 * 1024 * 1024, name } = {}) {
  const bin = await dockerBinary();
  if (!bin) return { code: 127, stdout: '', stderr: 'Docker CLI not found', ms: 0, timedOut: false, truncated: false };
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: env(bin), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out = [];
    const err = [];
    let size = 0;
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (name) execFile(bin, ['rm', '-f', name], { env: env(bin) }, () => {});
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (b) => {
      size += b.length;
      if (size > maxBytes) {
        truncated = true;
        return;
      }
      out.push(b);
    });
    child.stderr.on('data', (b) => {
      if (err.length < 200) err.push(b);
    });
    child.on('error', (e) => err.push(Buffer.from(String(e.message))));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), ms: Date.now() - t0, timedOut, truncated });
    });
    child.stdin.on('error', () => {});
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

let infoCache = null;
/** Is a Docker daemon reachable? Cached for 15 s so the UI can poll cheaply. */
export async function dockerInfo() {
  if (infoCache && Date.now() - infoCache.at < 15_000) return infoCache.value;
  const r = await docker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 8_000 });
  const value = r.code === 0
    ? { available: true, version: r.stdout.trim() }
    : { available: false, reason: r.code === 127 ? 'Docker is not installed' : 'Docker is installed but not running' };
  infoCache = { at: Date.now(), value };
  return value;
}

export function resetDockerInfo() {
  infoCache = null;
}

/** Local image size in bytes, or null when the image is not present. */
export async function imageSize(image) {
  const r = await docker(['image', 'inspect', '--format', '{{.Size}}', image], { timeoutMs: 10_000 });
  return r.code === 0 ? Number(r.stdout.trim()) || 0 : null;
}

export async function imageId(image) {
  const r = await docker(['image', 'inspect', '--format', '{{.Id}}', image], { timeoutMs: 10_000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function pull(image) {
  return docker(['pull', '--quiet', image], { timeoutMs: 15 * 60_000 });
}

/** Remove every container Indizia started (running or not) that carries `label`. */
export async function removeLabelled(label = LABEL) {
  const ls = await docker(['ps', '-aq', '--filter', `label=${label}`], { timeoutMs: 10_000 });
  const ids = ls.stdout.split(/\s+/).filter(Boolean);
  if (ids.length) await docker(['rm', '-f', ...ids], { timeoutMs: 30_000 });
  return ids.length;
}
