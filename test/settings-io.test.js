import { JSDOM } from "jsdom";
import fs from "node:fs";
import assert from "node:assert/strict";
import { buildExport, parseImport, settingsFilename } from "../src/settings-io.js";

const TOKEN = "kF3_9xQmZr-2LpVb7TnYcA0dEw4sHgJu8oXiRq1MkNa";
const stored = {
  instances: [{ host: "mastodon.social", token: TOKEN }, { host: "beige.party", token: "" }],
  lemmyHosts: ["lemmy.world"], sources: { hn: true, lobsters: false, reddit: true, publisher: true },
  resultsIn: "tab", tabTheme: "dark", tabContainerOn: true, tabContainer: "firefox-container-1",
};

// ---- pure functions ----
assert.equal(settingsFilename(new Date(2026, 9, 16)), "pre-check-page-shares-settings-2026-10-16.json");
const without = buildExport(stored, { version: "0.7.0", now: new Date("2026-10-16T00:00:00Z") });
assert.ok(!without.includes(TOKEN) && !without.includes('"token"'));              // no token field at all
assert.equal(JSON.parse(without).includesTokens, false);
const withTok = JSON.parse(buildExport(stored, { includeTokens: true }));
assert.equal(withTok.instances[0].token, TOKEN); assert.equal(withTok.includesTokens, true);
assert.equal(JSON.parse(buildExport({}, {})).resultsIn, "popup");                  // empty storage still exports sensibly

// round trip
const rt = parseImport(buildExport(stored, { includeTokens: true }));
assert.deepEqual(rt.settings.instances, stored.instances);
assert.deepEqual(rt.settings.sources, stored.sources);
assert.equal(rt.settings.tabContainer, "firefox-container-1"); assert.equal(rt.includesTokens, true);

// rejects bad input, and cleans hostile input
assert.match(parseImport("not json").error, /valid JSON/);
assert.match(parseImport('{"a":1}').error, /isn't a settings file/);
assert.match(parseImport("null").error, /isn't a settings file/);
const dirty = parseImport(JSON.stringify({ format: "pre-check-page-shares-settings", instances: [null, 5, { host: 7, token: {} }, { host: "a.example", token: "t", evil: 1 }],
  lemmyHosts: ["x.example", 3], sources: { hn: "yes", reddit: true, other: true }, resultsIn: "weird", tabTheme: "neon", tabContainerOn: "true", __proto__: { x: 1 } }));
assert.deepEqual(dirty.settings.instances, [{ host: "", token: "" }, { host: "a.example", token: "t" }]);   // junk entries dropped or blanked
assert.deepEqual(dirty.settings.lemmyHosts, ["x.example"]);
assert.deepEqual(dirty.settings.sources, { reddit: true });
assert.equal(dirty.settings.resultsIn, "popup"); assert.equal(dirty.settings.tabTheme, "auto"); assert.equal(dirty.settings.tabContainerOn, false);

// ---- the page ----
const html = fs.readFileSync(new URL("../src/options.html", import.meta.url), "utf8").replace(/<script[^>]*><\/script>/, "");
const dom = new JSDOM(html);
const { document, Event } = dom.window;
globalThis.document = document;
const downloads = [];
dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, download: this.download }); };
let store = { ...stored, instances: stored.instances.map((i) => ({ ...i })) };
globalThis.browser = {
  storage: { local: { get: async () => ({ ...store }), set: async (v) => Object.assign(store, v) } },
  permissions: { request: async () => true, remove: async () => true, contains: async () => true },
  contextualIdentities: { query: async () => [{ name: "personal", cookieStoreId: "firefox-container-1" }] },
  runtime: { getManifest: () => ({ version: "0.7.0" }) },
};
await import("../src/options.js");
const tick = () => new Promise((r) => setTimeout(r, 20));
await tick();
const $ = (id) => document.getElementById(id);

// layout: below Save, one row per button, the checkbox beside Export, a hint about secure storage
const order = [...document.querySelectorAll("#form button, #form .io-row, #form .hint")].map((x) => x.id || x.className);
assert.ok(document.querySelector('button[type="submit"]').compareDocumentPosition($("export")) & 4);  // Export follows Save
assert.equal($("export").parentElement.querySelector("#export-tokens") !== null, true);
assert.notEqual($("export").parentElement, $("import").parentElement);
assert.match(document.body.textContent, /keep the file in secure storage/);
assert.equal($("export-tokens").checked, false);                                                       // tokens are opt-in

// export without, then with, tokens
$("export").click(); await tick();
let out = decodeURIComponent(downloads.at(-1).href.split(",").slice(1).join(","));
assert.match(downloads.at(-1).download, /^pre-check-page-shares-settings-\d{4}-\d{2}-\d{2}\.json$/);
assert.ok(!out.includes(TOKEN)); assert.match($("io-status").textContent, /without tokens/);
$("export-tokens").checked = true; $("export").click(); await tick();
out = decodeURIComponent(downloads.at(-1).href.split(",").slice(1).join(","));
assert.ok(out.includes(TOKEN)); assert.match($("io-status").textContent, /secure storage/);

// import: fills the form but saves nothing
const pick = async (text) => {
  const file = { text: async () => text };
  const input = $("import-file");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change")); await tick();
};
const before = JSON.stringify(store);
await pick(JSON.stringify({ format: "pre-check-page-shares-settings", instances: [{ host: "https://Fosstodon.org/", token: "NEWTOKEN" }, { host: "not a host" }, { host: "mastodon.social" }],
  lemmyHosts: ["lemmy.ml", "bad host"], sources: { hn: false, lobsters: true, reddit: false, publisher: false }, resultsIn: "popup", tabTheme: "light", tabContainerOn: false }));
const rows = [...document.querySelectorAll("#rows .row")].map((r) => [r.querySelector(".host").value, r.querySelector(".token").value]);
assert.deepEqual(rows, [["fosstodon.org", "NEWTOKEN"], ["mastodon.social", TOKEN]]);     // a file without a token keeps the one already typed in
assert.equal($("lemmy").value, "lemmy.ml");
assert.deepEqual(["hn", "lobsters", "reddit", "publisher"].map((k) => $("src-" + k).checked), [false, true, false, false]);
assert.equal($("in-popup").checked, true); assert.equal($("tab-theme").value, "light"); assert.equal($("tab-container-on").checked, false);
assert.match($("io-status").textContent, /2 invalid entries were skipped/);
assert.match($("io-status").textContent, /press Save/);
assert.equal(JSON.stringify(store), before);                                              // nothing saved yet

// container choice is restored, falling back to Default when the container doesn't exist on this machine
await pick(JSON.stringify({ format: "pre-check-page-shares-settings", tabContainerOn: true, tabContainer: "firefox-container-1" }));
assert.equal($("tab-container-on").checked, true); assert.equal($("tab-container").value, "firefox-container-1");
await pick(JSON.stringify({ format: "pre-check-page-shares-settings", tabContainerOn: true, tabContainer: "firefox-container-99" }));
assert.equal($("tab-container").value, "firefox-default");

// a bad file changes nothing and says so
const snapshot = $("lemmy").value;
await pick("garbage");
assert.ok($("io-status").classList.contains("error")); assert.match($("io-status").textContent, /valid JSON/);
assert.equal($("lemmy").value, snapshot);
console.log("settings export/import tests passed");
