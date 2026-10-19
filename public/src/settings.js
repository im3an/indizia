// Per-browser settings. Keys never leave this browser except in requests to the service they belong to.
const KEY = 'sherlock.settings.v1';

export const DEFAULTS = {
  githubToken: '',
  otxKey: '', // AlienVault OTX: lifts the anonymous passive-DNS limit
  remoteSuggestions: true, // typeahead from Wikidata and GLEIF while typing an organisation name
  favicons: true, // source icons via the Indizia API (fetched server-side, no third-party request from the browser)
  pivotDepth: 2, // steps from the search that automatic pivots may reach (engine.js PIVOT_RULES)
  pivotBudget: 30, // source runs automatic pivots may start per investigation
  // Local toolbox (desktop app or INDIZIA_TOOLBOX=1): Docker containers on this computer.
  toolbox: true, // run subfinder on domain searches
  toolboxResolve: true, // resolve what subfinder finds with dnsx
  toolboxProbe: false, // visit each live host with httpx (contacts the target's servers)
  // Investigation briefs (agent/): which model phrases the summary. Keys stay in this browser.
  agentProvider: 'local', // 'local' (Ollama via the Indizia API on this computer) | 'anthropic' | 'rules'
  anthropicKey: '',
  anthropicModel: '',
  agentLimits: null,
};

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSetting(name) {
  return getSettings()[name];
}

export function setSetting(name, value) {
  const next = { ...getSettings(), [name]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: setting lasts for this page only */
  }
  return next;
}
