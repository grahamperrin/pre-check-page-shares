import { normalizeHost } from "./lib.js";

const $ = (id) => document.getElementById(id);
const form = $("form");
const rows = $("rows");
const tpl = $("row-tpl");
const status = $("status");

const DEFAULT_SOURCES = { hn: true, lobsters: true, reddit: false, publisher: true };
const ORIGIN_OF = { lobsters: "https://lobste.rs/*", reddit: "https://www.reddit.com/*" }; // sources that need host permission

// Hint under each row: a link to the server's token page, or an error after a failed save.
function refreshHint(row, error) {
  const hint = row.querySelector(".hint");
  hint.replaceChildren();
  hint.classList.toggle("error", Boolean(error));
  if (error) { hint.textContent = error; return; }
  const host = normalizeHost(row.querySelector(".host").value);
  if (!host) return;
  if (!row.querySelector(".token").value.trim()) hint.append("No token yet, so post search will be skipped. ");
  const a = document.createElement("a");
  a.href = `https://${host}/settings/applications`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = "Create a token on this server ↗";
  hint.append(a);
}

function addRow({ host = "", token = "" } = {}) {
  const row = tpl.content.firstElementChild.cloneNode(true);
  row.querySelector(".host").value = host;
  row.querySelector(".token").value = token;
  row.querySelector(".remove").addEventListener("click", () => {
    row.remove();
    if (!rows.children.length) addRow();
  });
  for (const input of row.querySelectorAll("input")) input.addEventListener("input", () => refreshHint(row));
  rows.append(row);
  refreshHint(row);
  return row;
}

// Mastodon rows -> [{host, token}] or null if any row is invalid (errors are shown on the rows).
function collectMastodon() {
  const out = [];
  const seen = new Set();
  let ok = true;
  for (const row of rows.children) {
    const rawHost = row.querySelector(".host").value.trim();
    const token = row.querySelector(".token").value.trim();
    if (!rawHost && !token) continue; // blank row: ignore
    const host = normalizeHost(rawHost);
    let error = null;
    if (!rawHost) error = "Enter the server this token belongs to, e.g. mastodon.social.";
    else if (!host && /^[\w-]{20,}$/.test(rawHost)) error = "That looks like an access token. Put it in the token field, and the server name here.";
    else if (!host) error = "That isn't a server name. Use just the domain, e.g. mastodon.social.";
    else if (seen.has(host)) error = "This server is listed twice.";
    if (error) { ok = false; refreshHint(row, error); continue; }
    seen.add(host);
    out.push({ host, token });
  }
  return ok ? out : null;
}

// Lemmy textarea -> [host] or null if any line is invalid.
function collectLemmy() {
  const hint = $("lemmy-hint");
  const out = [];
  const bad = [];
  for (const line of $("lemmy").value.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const host = normalizeHost(line);
    if (!host) bad.push(line.length > 40 ? line.slice(0, 40) + "…" : line);
    else if (!out.includes(host)) out.push(host);
  }
  hint.classList.toggle("error", bad.length > 0);
  if (bad.length) { hint.textContent = `Not a server name: ${bad.join(", ")}. Use just the domain, e.g. lemmy.world.`; return null; }
  return out;
}

// Container choice for the results tab. Listing containers needs "contextualIdentities", which Firefox only allows as
// a normal (no-prompt) manifest permission. Opening a tab in a container is documented to need "cookies", which is
// optional: requested only when the box is ticked (a user action) and given back when it is unticked and saved.
const CONTAINER_PERMS = ["cookies"];

async function fillContainers(selected) {
  const sel = $("tab-container");
  sel.replaceChildren();
  const add = (value, label) => { const o = document.createElement("option"); o.value = value; o.textContent = label; sel.append(o); };
  add("firefox-default", "Default (no container)");
  let found = [];
  try { found = (await browser.contextualIdentities?.query({})) ?? []; } catch { /* feature off or permission missing */ }
  for (const c of found) add(c.cookieStoreId, c.name);
  sel.value = [...sel.options].some((o) => o.value === selected) ? selected : "firefox-default";
  $("container-none").hidden = found.length > 0;
}

$("tab-container-on").addEventListener("change", async () => {
  const on = $("tab-container-on").checked;
  $("tab-container").disabled = !on;
  if (!on) return;
  const granted = await browser.permissions.request({ permissions: CONTAINER_PERMS });
  if (!granted) {
    $("tab-container-on").checked = false;
    $("tab-container").disabled = true;
    status.textContent = "Permission denied, so the container choice stays off.";
    return;
  }
  status.textContent = "";
  await fillContainers($("tab-container").value);
});

const readSources = () => ({ hn: $("src-hn").checked, lobsters: $("src-lobsters").checked, reddit: $("src-reddit").checked, publisher: $("src-publisher").checked });

// Every origin the saved settings need permission for.
const originsFor = (instances, lemmyHosts, sources) => [
  ...instances.map((i) => `https://${i.host}/*`),
  ...lemmyHosts.map((h) => `https://${h}/*`),
  ...Object.entries(ORIGIN_OF).filter(([k]) => sources[k]).map(([, o]) => o),
];

let saving = false;
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (saving) return;
  saving = true;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try { await save(); } finally { saving = false; button.disabled = false; }
});

async function save() {
  status.textContent = "";
  const instances = collectMastodon();
  const lemmyHosts = collectLemmy();
  if (!instances || !lemmyHosts) { status.textContent = "Fix the highlighted entries first."; return; }
  const sources = readSources();

  // Ask for permission first: it must happen straight from this user action.
  const wanted = originsFor(instances, lemmyHosts, sources);
  const containerOn = $("tab-container-on").checked;
  if (wanted.length || containerOn) {
    const granted = await browser.permissions.request({ origins: wanted, permissions: containerOn ? CONTAINER_PERMS : [] });
    if (!granted) { status.textContent = "Permission denied, so nothing was saved."; return; }
  }

  // Drop access to places that were removed or switched off.
  const old = await browser.storage.local.get(["instances", "lemmyHosts", "sources", "tabContainerOn"]);
  const oldOrigins = originsFor(
    (old.instances ?? []).filter((i) => normalizeHost(i.host)).map((i) => ({ host: normalizeHost(i.host) })),
    (old.lemmyHosts ?? []).filter((h) => normalizeHost(h)).map((h) => normalizeHost(h)),
    { ...DEFAULT_SOURCES, ...(old.sources ?? {}) }
  );
  const removed = oldOrigins.filter((o) => !wanted.includes(o));
  if (removed.length) await browser.permissions.remove({ origins: removed }).catch(() => {});
  if (!containerOn && old.tabContainerOn) await browser.permissions.remove({ permissions: CONTAINER_PERMS }).catch(() => {});

  await browser.storage.local.set({ instances, lemmyHosts, sources, resultsIn: $("in-tab").checked ? "tab" : "popup", tabTheme: $("tab-theme").value, tabContainerOn: containerOn, tabContainer: $("tab-container").value || "firefox-default" });
  for (const row of rows.children) refreshHint(row);
  status.textContent = "Saved.";
}

$("add").addEventListener("click", () => addRow().querySelector(".host").focus());

browser.storage.local.get(["instances", "lemmyHosts", "sources", "resultsIn", "tabTheme", "tabContainerOn", "tabContainer"]).then(async ({ instances = [], lemmyHosts = [], sources, resultsIn = "popup", tabTheme = "auto", tabContainerOn = false, tabContainer = "firefox-default" }) => {
  $("in-tab").checked = resultsIn === "tab";
  $("in-popup").checked = resultsIn !== "tab";
  $("tab-theme").value = tabTheme;
  // Only show the container choice as on if the permissions it needs are still held (they can be revoked in about:addons).
  const held = tabContainerOn && (await browser.permissions.contains({ permissions: CONTAINER_PERMS }).catch(() => false));
  $("tab-container-on").checked = Boolean(held);
  $("tab-container").disabled = !held;
  if (held) await fillContainers(tabContainer);
  if (instances.length) instances.forEach(addRow);
  else addRow();
  $("lemmy").value = lemmyHosts.join("\n");
  const s = { ...DEFAULT_SOURCES, ...(sources ?? {}) };
  $("src-hn").checked = s.hn;
  $("src-lobsters").checked = s.lobsters;
  $("src-reddit").checked = s.reddit;
  $("src-publisher").checked = s.publisher;
});
