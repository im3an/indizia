// Local AI bridge: forwards to an Ollama server on this machine (default http://127.0.0.1:11434), so
// investigation text never leaves the computer. Enabled in the desktop app and on a local server with
// INDIZIA_AI=1 (or INDIZIA_TOOLBOX=1); never on the public Worker. Model output is only ever used as text:
// the agent validates citations and cannot call tools from it (public/src/agent/).
import { localGuard } from './toolbox.mjs';

const OLLAMA = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MAX_BODY = 400_000;
// Image, video and 3D models in a local Ollama are not text models.
const NOT_TEXT = /image|flux|trellis|diffusion|sdxl|wan|ltx|llava-?phi|clip/i;

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

let tagsCache = null;
async function models() {
  if (tagsCache && Date.now() - tagsCache.at < 20_000) return tagsCache.value;
  let value;
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const { models: list = [] } = await r.json();
    const all = list.map((m) => ({ name: m.name, sizeGB: Math.round((m.size / 1e9) * 10) / 10, family: m.details?.family || '', params: m.details?.parameter_size || '' }));
    const embed = all.filter((m) => /embed|bge|e5|minilm|nomic-bert/i.test(`${m.name} ${m.family}`));
    const chat = all.filter((m) => !embed.includes(m) && !NOT_TEXT.test(`${m.name} ${m.family}`));
    // Prefer small, fast instruction models for routing and summaries (docs/research/01 §B.8).
    const pref = [/qwen3(?!.*(?:30b|32b|70b))/i, /llama3\.[12]/i, /gemma3/i, /mistral/i, /phi/i, /qwen/i];
    // 1- and 2-bit quantisations are too lossy for faithful summaries.
    const rank = (m) => {
      const i = pref.findIndex((re) => re.test(m.name));
      return (/\b(?:I?Q1|I?Q2)[_.-]|IQ2_|IQ1_/i.test(m.name) ? 5000 : 0) + (i < 0 ? 50 : i) * 100 + m.sizeGB;
    };
    chat.sort((a, b) => rank(a) - rank(b));
    value = { available: chat.length > 0 || embed.length > 0, provider: 'ollama', host: OLLAMA, chat, embed, chatModel: chat[0]?.name || null, embedModel: embed[0]?.name || null };
  } catch {
    value = { available: false, provider: 'ollama', host: OLLAMA, reason: `No Ollama server answered at ${OLLAMA}`, chat: [], embed: [] };
  }
  tagsCache = { at: Date.now(), value };
  return value;
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('request too large');
  return JSON.parse(text || '{}');
}

/** @param {{ trusted?: boolean }} opts */
export async function handleAi(request, opts = {}) {
  if (!opts.trusted) {
    const refused = localGuard(request);
    if (refused) return refused;
  }
  const { pathname } = new URL(request.url);
  if (pathname === '/api/ai/status' && request.method === 'GET') return json(await models());

  if (request.method !== 'POST') return json({ error: 'not found' }, 404);
  let body;
  try {
    body = await readBody(request);
  } catch (err) {
    return json({ error: err.message }, 413);
  }
  const m = await models();
  if (pathname === '/api/ai/embed') {
    const model = m.embed.some((x) => x.name === body.model) ? body.model : m.embedModel;
    if (!model) return json({ error: 'no embedding model installed (try: ollama pull nomic-embed-text)' }, 503);
    const input = (Array.isArray(body.input) ? body.input : [body.input]).slice(0, 64).map((s) => String(s).slice(0, 8000));
    try {
      const r = await fetch(`${OLLAMA}/api/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }), signal: AbortSignal.timeout(120_000) });
      const d = await r.json();
      if (!r.ok) return json({ error: d.error || `Ollama HTTP ${r.status}` }, 502);
      return json({ model, embeddings: d.embeddings });
    } catch {
      return json({ error: 'Ollama did not answer' }, 502);
    }
  }
  if (pathname === '/api/ai/chat') {
    const model = m.chat.some((x) => x.name === body.model) ? body.model : m.chatModel;
    if (!model) return json({ error: 'no text model installed (try: ollama pull qwen3:4b)' }, 503);
    const messages = (Array.isArray(body.messages) ? body.messages : []).slice(0, 40).map((x) => ({ role: ['system', 'user', 'assistant'].includes(x.role) ? x.role : 'user', content: String(x.content || '').slice(0, 120_000) }));
    try {
      const r = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, think: false, format: body.format === 'json' ? 'json' : undefined, options: { temperature: 0.1, num_ctx: 16384, ...(body.options || {}) } }),
        signal: AbortSignal.timeout(240_000),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d.error || `Ollama HTTP ${r.status}` }, 502);
      return json({ model, content: d.message?.content || '', ms: Math.round((d.total_duration || 0) / 1e6), tokens: d.eval_count || null });
    } catch {
      return json({ error: 'Ollama did not answer in time' }, 504);
    }
  }
  return json({ error: 'not found' }, 404);
}
