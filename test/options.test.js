import { JSDOM } from "jsdom";
import fs from "node:fs";
import assert from "node:assert/strict";
import { normalizeHost } from "../src/lib.js";

assert.equal(normalizeHost("https://Mastodon.Social/@me?x=1"), "mastodon.social");
const TOKEN = "kF3_9xQmZr-2LpVb7TnYcA0dEw4sHgJu8oXiRq1MkNa";
for (const bad of ["", TOKEN, "exa mple.com", "me@mastodon.social", "localhost", null]) assert.equal(normalizeHost(bad), null);

const html = fs.readFileSync(new URL("../src/options.html", import.meta.url), "utf8").replace(/<script[^>]*><\/script>/, "");
const dom = new JSDOM(html);
const { document, Event } = dom.window;
globalThis.document = document;
let store = { instances: [{ host: TOKEN, token: "" }] };           // what the earlier mistaken save left behind
const requested = [], removed = [], permsRequested = [], permsRemoved = [];
let grant = true;
globalThis.browser = {
  storage: { local: { get: async () => ({ ...store }), set: async (v) => Object.assign(store, v) } },
  permissions: {
    request: async ({ origins = [], permissions = [] }) => (requested.push(...origins), permsRequested.push(...permissions), grant),
    remove: async ({ origins = [], permissions = [] }) => (removed.push(...origins), permsRemoved.push(...permissions), true),
    contains: async () => true,
  },
  contextualIdentities: { query: async () => [{ name: "personal", cookieStoreId: "firefox-container-1" }, { name: "temp", cookieStoreId: "firefox-container-2" }] },
};
await import("../src/options.js");
await new Promise((r) => setTimeout(r, 10));

const $ = (id) => document.getElementById(id);
const rows = () => [...document.querySelectorAll("#rows .row")];
const hint = (row) => row.querySelector(".hint");
const fill = (row, host, token) => { row.querySelector(".host").value = host; row.querySelector(".token").value = token; row.querySelector(".host").dispatchEvent(new Event("input")); };
const submit = async () => { requested.length = 0; removed.length = 0; $("form").dispatchEvent(new Event("submit", { cancelable: true })); await new Promise((r) => setTimeout(r, 10)); };

// defaults: Reddit starts switched OFF (it needs your reddit.com cookies); the others start on
assert.deepEqual(["hn", "lobsters", "reddit", "publisher"].map((k) => $("src-" + k).checked), [true, true, false, true]);
assert.equal(document.getElementById("src-reddit-cookies"), null);                         // single Reddit checkbox
assert.match(document.querySelector("#src-reddit").closest("label").textContent, /Asks www\.reddit\.com whether the link has been submitted\. This involves your Firefox session's cookies for reddit\.com – without these cookies, an HTTP 403 error may be expected\./);

// the earlier mistake (token in the server field) is refused, nothing saved
assert.equal(rows().length, 1);
await submit();
assert.match(hint(rows()[0]).textContent, /looks like an access token/);
assert.equal(requested.length, 0);
assert.deepEqual(store.instances, [{ host: TOKEN, token: "" }]);

// a correct pair + a token-less second server (warned, not blocked)
fill(rows()[0], "https://Mastodon.Social/", TOKEN);
$("add").dispatchEvent(new Event("click"));
fill(rows()[1], "fosstodon.org", "");
await submit();
assert.deepEqual(store.instances, [{ host: "mastodon.social", token: TOKEN }, { host: "fosstodon.org", token: "" }]);
assert.deepEqual(requested, ["https://mastodon.social/*", "https://fosstodon.org/*", "https://lobste.rs/*"]);   // no Reddit permission while Reddit is off
assert.deepEqual(store.sources, { hn: true, lobsters: true, reddit: false, publisher: true });
assert.deepEqual(store.lemmyHosts, []);
assert.match(hint(rows()[1]).textContent, /No token yet/);

// Lemmy list: bad line refused with a message; good lines normalised and permission requested
$("lemmy").value = "lemmy.world\nnot a host!\n";
await submit();
assert.ok($("lemmy-hint").classList.contains("error"));
assert.match($("lemmy-hint").textContent, /not a host!/);
assert.deepEqual(store.lemmyHosts, []);                              // not saved
$("lemmy").value = "lemmy.world\nhttps://Lemmy.ml/\nlemmy.world\n";
await submit();
assert.deepEqual(store.lemmyHosts, ["lemmy.world", "lemmy.ml"]);     // normalised, de-duplicated
assert.ok(requested.includes("https://lemmy.world/*") && requested.includes("https://lemmy.ml/*"));

// duplicate Mastodon server refused
$("add").dispatchEvent(new Event("click"));
fill(rows()[2], "mastodon.social", "x"); await submit();
assert.match(hint(rows()[2]).textContent, /listed twice/);
rows()[2].querySelector(".remove").click();

// switching Reddit ON asks for its permission; switching it off again (and removing a server) revokes both
$("src-reddit").checked = true;
await submit();
assert.equal(store.sources.reddit, true);
assert.ok(requested.includes("https://www.reddit.com/*"));
$("src-reddit").checked = false;
rows()[1].querySelector(".remove").click();
await submit();
assert.deepEqual(store.sources, { hn: true, lobsters: true, reddit: false, publisher: true });
assert.deepEqual(removed.sort(), ["https://fosstodon.org/*", "https://www.reddit.com/*"]);
assert.ok(!requested.includes("https://www.reddit.com/*"));

// Where results appear + tab colours: defaults, then saved
assert.equal($("in-popup").checked, true); assert.equal($("in-tab").checked, false); assert.equal($("tab-theme").value, "auto");
$("in-tab").checked = true; $("in-popup").checked = false; $("tab-theme").value = "light";
await submit();
assert.equal(store.resultsIn, "tab"); assert.equal(store.tabTheme, "light");
$("in-popup").checked = true; $("in-tab").checked = false; $("tab-theme").value = "auto";
await submit();
assert.equal(store.resultsIn, "popup"); assert.equal(store.tabTheme, "auto");

// ---- container choice for the results tab ----
const tick = () => new Promise((r) => setTimeout(r, 10));
const opts = () => [...$("tab-container").options].map((o) => [o.value, o.textContent]);
assert.equal($("tab-container-on").checked, false); assert.equal($("tab-container").disabled, true);   // off by default

// ticking asks for the two permissions straight away, then lists the containers
$("tab-container-on").checked = true; $("tab-container-on").dispatchEvent(new Event("change")); await tick();
assert.deepEqual(permsRequested, ["cookies"]);
assert.equal($("tab-container").disabled, false);
assert.deepEqual(opts(), [["firefox-default", "Default (no container)"], ["firefox-container-1", "personal"], ["firefox-container-2", "temp"]]);
assert.equal($("container-none").hidden, true);

// choosing one and saving stores it
$("tab-container").value = "firefox-container-1";
await submit();
assert.equal(store.tabContainerOn, true); assert.equal(store.tabContainer, "firefox-container-1");

// permission refused: the box un-ticks itself, nothing is left half-enabled
$("tab-container-on").checked = false; $("tab-container-on").dispatchEvent(new Event("change")); await tick();
grant = false;
$("tab-container-on").checked = true; $("tab-container-on").dispatchEvent(new Event("change")); await tick();
assert.equal($("tab-container-on").checked, false); assert.equal($("tab-container").disabled, true);
assert.match($("status").textContent, /Permission denied/);
grant = true;

// no containers (feature off): the default is still offered, with an explanation
globalThis.browser.contextualIdentities = undefined;
$("tab-container-on").checked = true; $("tab-container-on").dispatchEvent(new Event("change")); await tick();
assert.deepEqual(opts(), [["firefox-default", "Default (no container)"]]);
assert.equal($("container-none").hidden, false);
globalThis.browser.contextualIdentities = { query: async () => [{ name: "personal", cookieStoreId: "firefox-container-1" }] };

// switching it off and saving hands the permissions back and stores the choice as off
$("tab-container-on").checked = false; $("tab-container-on").dispatchEvent(new Event("change")); await tick();
permsRemoved.length = 0;
await submit();
assert.equal(store.tabContainerOn, false);
assert.deepEqual(permsRemoved, ["cookies"]);

// Two submits fired back-to-back (double click, or Enter while the permission prompt is open): only one save runs.
let slowCalls = 0;
globalThis.browser.permissions.request = async () => { slowCalls++; await new Promise((r) => setTimeout(r, 30)); return true; };
$("form").dispatchEvent(new Event("submit", { cancelable: true }));
$("form").dispatchEvent(new Event("submit", { cancelable: true }));
assert.equal(document.querySelector('button[type="submit"]').disabled, true);
await new Promise((r) => setTimeout(r, 80));
assert.equal(slowCalls, 1);
assert.equal(document.querySelector('button[type="submit"]').disabled, false);
assert.equal($("status").textContent, "Saved.");

for (const [held, expectChecked] of [[true, true], [false, false]]) {
  const d2 = new JSDOM(html); globalThis.document = d2.window.document;
  store.tabContainerOn = true; store.tabContainer = "firefox-container-1";
  globalThis.browser.permissions.contains = async () => held;
  await import(`../src/options.js?reload=${held}`); await tick();
  assert.equal(d2.window.document.getElementById("tab-container-on").checked, expectChecked);
  if (held) assert.equal(d2.window.document.getElementById("tab-container").value, "firefox-container-1");
}
console.log("settings tests passed");
