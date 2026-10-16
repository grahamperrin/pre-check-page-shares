// Export / import of the extension's settings as a JSON file. Pure functions, so they are easy to test.

export const FORMAT = "pre-check-page-shares-settings";
const SOURCE_KEYS = ["hn", "lobsters", "reddit", "publisher"];

const pad = (n) => String(n).padStart(2, "0");
export const settingsFilename = (d = new Date()) =>
  `pre-check-page-shares-settings-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;

// stored: what is in browser.storage.local. Tokens are only included when asked for.
export function buildExport(stored, { includeTokens = false, version = "", now = new Date() } = {}) {
  const out = {
    format: FORMAT,
    version,
    exportedAt: now.toISOString(),
    includesTokens: Boolean(includeTokens),
    instances: (stored.instances ?? []).map((i) => (includeTokens ? { host: i.host, token: i.token ?? "" } : { host: i.host })),
    lemmyHosts: stored.lemmyHosts ?? [],
    sources: stored.sources ?? {},
    resultsIn: stored.resultsIn ?? "popup",
    tabTheme: stored.tabTheme ?? "auto",
    tabContainerOn: Boolean(stored.tabContainerOn),
    tabContainer: stored.tabContainer ?? "firefox-default",
  };
  return JSON.stringify(out, null, 2) + "\n";
}

// Reads text from a file the user chose. Returns { settings } or { error }. Nothing is trusted:
// every field is type-checked and unknown fields are dropped. Host names are validated by the caller (normalizeHost).
export function parseImport(text) {
  let d;
  try { d = JSON.parse(text); } catch { return { error: "That file isn't valid JSON." }; }
  if (!d || typeof d !== "object" || d.format !== FORMAT) return { error: "That isn't a settings file exported by this extension." };
  const str = (v) => (typeof v === "string" ? v : "");
  const instances = Array.isArray(d.instances) ? d.instances.filter((i) => i && typeof i === "object").map((i) => ({ host: str(i.host), token: str(i.token) })) : [];
  const lemmyHosts = Array.isArray(d.lemmyHosts) ? d.lemmyHosts.filter((h) => typeof h === "string") : [];
  const sources = {};
  for (const k of SOURCE_KEYS) if (typeof d.sources?.[k] === "boolean") sources[k] = d.sources[k];
  return {
    settings: {
      instances, lemmyHosts, sources,
      resultsIn: d.resultsIn === "tab" ? "tab" : "popup",
      tabTheme: ["auto", "light", "dark"].includes(d.tabTheme) ? d.tabTheme : "auto",
      tabContainerOn: d.tabContainerOn === true,
      tabContainer: str(d.tabContainer) || "firefox-default",
    },
    includesTokens: d.includesTokens === true,
  };
}

// data: URL download, as for the Markdown file (needs no "downloads" permission).
export function downloadText(filename, text, type = "application/json") {
  const a = document.createElement("a");
  a.href = `data:${type};charset=utf-8,` + encodeURIComponent(text);
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
}
