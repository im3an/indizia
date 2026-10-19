// Network engine for the desktop app. "builtin": the Indizia API runs inside the app process.
// "container": the same API runs in a locked-down Docker container built from the app's own bundled code,
// published on 127.0.0.1 only, and removed when the app quits. If the container cannot start, the app keeps
// working on the built-in engine and says why.
import { cp, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ENGINE_LABEL = 'app.indizia.engine';

export class Engine {
  /**
   * @param {object} o
   * @param {string} o.resources directory holding server/, public/ and docker/
   * @param {string} o.version   app version, used as the image tag
   * @param {(mode: string) => void} [o.onPreference] persist the chosen mode
   */
  constructor({ resources, version, onPreference = () => {} }) {
    this.resources = resources;
    this.image = `indizia-engine:${version}`;
    this.onPreference = onPreference;
    this.preferred = 'builtin';
    this.state = 'off';
    this.error = null;
    this.port = null;
    this.name = null;
    this.op = Promise.resolve();
  }

  async docker() {
    return import(pathToFileURL(join(this.resources, 'server', 'docker.mjs')).href);
  }

  /** Base URL of the running container, or null (requests then run in-process). */
  upstream() {
    return this.state === 'running' && this.port ? `http://127.0.0.1:${this.port}` : null;
  }

  status() {
    return {
      mode: this.upstream() ? 'container' : 'built-in',
      preferred: this.preferred,
      state: this.preferred === 'container' ? this.state : 'off',
      image: this.image,
      error: this.error,
    };
  }

  /** Resolves when the current start or stop has finished, or after `ms`. */
  ready(ms = 30_000) {
    return Promise.race([this.op, new Promise((r) => setTimeout(r, ms))]);
  }

  /** Switch modes; calls are serialised so a quick toggle cannot leave two containers. */
  setMode(mode) {
    this.preferred = mode;
    this.onPreference(mode);
    this.op = this.op.then(() => (mode === 'container' ? this.start() : this.stop())).catch(() => {});
    // Answer once the container is up (or failed); the UI polls while it starts.
    return mode === 'container' ? Promise.race([this.op, new Promise((r) => setTimeout(r, 400))]) : this.op;
  }

  async start() {
    if (this.upstream()) return;
    const d = await this.docker();
    this.error = null;
    this.state = 'starting';
    const info = await d.dockerInfo();
    if (!info.available) return this.fail(info.reason);
    await d.removeLabelled(ENGINE_LABEL); // leftovers from a crash

    if (!(await d.imageId(this.image))) {
      this.state = 'building';
      const ctx = await mkdtemp(join(tmpdir(), 'indizia-engine-'));
      try {
        // Minimal build context: only the API code, never the user's files.
        await cp(join(this.resources, 'server'), join(ctx, 'server'), { recursive: true });
        await mkdir(join(ctx, 'public', 'src'), { recursive: true });
        await cp(join(this.resources, 'public', 'src', 'hosting.js'), join(ctx, 'public', 'src', 'hosting.js'));
        await cp(join(this.resources, 'docker', 'engine.Dockerfile'), join(ctx, 'Dockerfile'));
        const b = await d.docker(['build', '--quiet', '--label', `${d.LABEL}=1`, '-t', this.image, ctx], { timeoutMs: 10 * 60_000 });
        if (b.code !== 0) return this.fail(`image build failed: ${b.stderr.trim().split('\n').at(-1) || b.code}`);
      } finally {
        await rm(ctx, { recursive: true, force: true });
      }
      this.state = 'starting';
    }

    this.name = `indizia-engine-${process.pid}`;
    const r = await d.docker([
      'run', '-d', '--rm', '--name', this.name, ...d.HARDENING, '--label', `${ENGINE_LABEL}=1`,
      '--memory', '384m', '--cpus', '1', '--user', 'node', '-p', '127.0.0.1::8080', this.image,
    ], { timeoutMs: 60_000 });
    if (r.code !== 0) return this.fail(`container did not start: ${r.stderr.trim().split('\n').at(-1)}`);
    const p = await d.docker(['port', this.name, '8080/tcp'], { timeoutMs: 10_000 });
    const port = Number(/:(\d+)\s*$/m.exec(p.stdout)?.[1]);
    if (!port) return this.fail('could not read the container port');

    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          this.port = port;
          this.state = 'running';
          return;
        }
      } catch {
        /* still booting */
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    await this.stop();
    return this.fail('container did not become healthy');
  }

  fail(reason) {
    this.state = 'error';
    this.error = reason;
    this.port = null;
  }

  async stop() {
    const name = this.name;
    this.port = null;
    this.name = null;
    this.state = 'off';
    if (!name) return;
    const d = await this.docker();
    await d.docker(['rm', '-f', name], { timeoutMs: 20_000 });
  }

  /** Remove the engine image too (Settings → clean up, or uninstall). */
  async purge() {
    await this.stop();
    const d = await this.docker();
    await d.docker(['image', 'rm', '-f', this.image], { timeoutMs: 60_000 });
  }
}
