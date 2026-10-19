// Model providers for the agent. "local": Ollama on this computer through /api/ai/chat (desktop app, or a
// local server with INDIZIA_AI=1); nothing leaves the machine. "anthropic": the user's own API key, called
// from this browser (opt-in; the evidence text is then processed by Anthropic). "rules": no model at all.

import { getSetting } from '../settings.js';
import { aiStatus } from '../docs/semantic.js';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-5-5';

export async function providers() {
  const local = await aiStatus();
  const key = getSetting('anthropicKey');
  return [
    { id: 'local', label: local.chatModel ? `On this computer (${local.chatModel})` : 'On this computer (no local model)', available: !!local.chatModel, model: local.chatModel || null },
    { id: 'anthropic', label: key ? `Anthropic API, your key (${getSetting('anthropicModel') || ANTHROPIC_DEFAULT_MODEL})` : 'Anthropic API (add your key in Settings)', available: !!key, model: getSetting('anthropicModel') || ANTHROPIC_DEFAULT_MODEL },
    { id: 'rules', label: 'No model: rules only', available: true, model: null },
  ];
}

/** The provider to use: the user's choice if available, otherwise local, otherwise rules. */
export async function pickProvider(pref = getSetting('agentProvider')) {
  const list = await providers();
  return list.find((p) => p.id === pref && p.available) || list.find((p) => p.id === 'local' && p.available) || list.find((p) => p.id === 'rules');
}

/** @returns {Promise<{ content: string, model: string, ms: number }>} */
export async function chat(provider, messages, { json = false, signal } = {}) {
  const t0 = performance.now();
  if (provider.id === 'local') {
    const r = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Indizia-Local': '1' }, body: JSON.stringify({ messages, format: json ? 'json' : undefined }), signal });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `local model: HTTP ${r.status}`);
    return { content: d.content, model: d.model, ms: Math.round(performance.now() - t0) };
  }
  if (provider.id === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getSetting('anthropicKey'),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(anthropicRequest(provider.model, messages)),
      signal,
      referrerPolicy: 'no-referrer',
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 401 ? 'Anthropic rejected the API key (check it in Settings)' : d.error?.message || `Anthropic API: HTTP ${r.status}`);
    return { ...anthropicAnswer(d), model: d.model || provider.model, ms: Math.round(performance.now() - t0) };
  }
  throw new Error('no model selected');
}

/**
 * Messages API body. Current models think adaptively (always on for Haiku 5.5 and Opus 5.5) and reject sampling
 * parameters such as temperature, so effort is the only control; thinking tokens count against max_tokens.
 */
export function anthropicRequest(model, messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  return { model, max_tokens: 16000, output_config: { effort: 'medium' }, system, messages: messages.filter((m) => m.role !== 'system') };
}

/** The text of a Messages API answer; a refusal or a cut-off answer is an error, never a partial brief. */
export function anthropicAnswer(d) {
  if (d.stop_reason === 'refusal') throw new Error(`The model declined this brief${d.stop_details?.category ? ` (${d.stop_details.category})` : ''}. Try the local model or rules only.`);
  if (d.stop_reason === 'max_tokens') throw new Error('The model ran out of room before finishing the brief');
  return { content: (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('') };
}
