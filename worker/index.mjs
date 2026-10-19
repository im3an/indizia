// Cloudflare Worker entry: API routes run here; everything else is served from static assets (public/).
import { handleApi } from '../server/api.mjs';

export default {
  async fetch(request, env) {
    // Platform rate limiters from wrangler.toml; they count across all Worker instances in a location.
    const limiters = { relay: env.RL_RELAY, username: env.RL_USERNAME, fingerprint: env.RL_FINGERPRINT, icon: env.RL_ICON };
    const api = await handleApi(request, { limiters });
    if (api) return api;
    return env.ASSETS.fetch(request);
  },
};
