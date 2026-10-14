import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// ---- a mock browser with just enough for background.js ----
const store = { local: {} };
const calls = { setPopup: [], created: [], exec: 0 };
const listeners = { clicked: null, changed: null };
globalThis.browser = {
  storage: {
    local: { get: async (k) => (typeof k === "string" ? { [k]: store.local[k] } : Object.fromEntries(Object.entries(store.local).filter(([x]) => k.includes(x)))) },
    onChanged: { addListener: (f) => (listeners.changed = f) },
  },
  action: { setPopup: async (o) => calls.setPopup.push(o.popup), onClicked: { addListener: (f) => (listeners.clicked = f) } },
  runtime: { getURL: (p) => `moz-extension://abc/${p}`, onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  scripting: { executeScript: async () => { calls.exec++; return [{ result: [{ acct: "creativecommons@mastodon.social", via: "profile link" }, { acct: "x@medium.com", via: "profile link" }] }]; } },
  tabs: { create: async (o) => { if (calls.failContainer && o.cookieStoreId) throw new Error("No permission for cookieStoreId"); calls.created.push(o); } },
};
const tick = () => new Promise((r) => setTimeout(r, 5));
await import("../src/background.js");
await tick();

// default (no setting stored): the popup stays on
assert.deepEqual(calls.setPopup, ["popup.html"]);

// choosing "tab" in Settings switches the popup off, so the toolbar button fires onClicked
store.local.resultsIn = "tab";
listeners.changed({ resultsIn: { newValue: "tab" } }, "local"); await tick();
assert.equal(calls.setPopup.at(-1), "");
// unrelated changes (and other storage areas) do nothing
const n = calls.setPopup.length;
listeners.changed({ instances: {} }, "local"); listeners.changed({ resultsIn: {} }, "sync"); await tick();
assert.equal(calls.setPopup.length, n);

// click: the page is scanned now (activeTab), a results tab opens next to it, carrying url, title and candidates
await listeners.clicked({ id: 7, index: 3, url: "https://creativecommons.org/2026/09/21/a-principled-approach-as-the-sands-shift/", title: "A Principled Approach" });
assert.equal(calls.exec, 1);
const t = calls.created[0];
assert.equal(t.index, 4); assert.equal(t.openerTabId, 7);
const u = new URL(t.url);
assert.equal(u.protocol + "//" + u.host + u.pathname, "moz-extension://abc/results.html");
assert.equal(u.searchParams.get("url"), "https://creativecommons.org/2026/09/21/a-principled-approach-as-the-sands-shift/");
assert.equal(u.searchParams.get("title"), "A Principled Approach");
assert.deepEqual(JSON.parse(u.searchParams.get("c")), [{ acct: "creativecommons@mastodon.social", via: "profile link" }]);   // medium.com filtered

// page-account check switched off: the page is never read
store.local.sources = { publisher: false };
await listeners.clicked({ id: 8, index: 0, url: "https://example.com/x", title: "x" });
assert.equal(calls.exec, 1);
assert.deepEqual(JSON.parse(new URL(calls.created[1].url).searchParams.get("c")), []);

// a restricted page (about:, etc.): still opens the results page, which says what is wrong; nothing is scanned
store.local.sources = {};
await listeners.clicked({ id: 9, index: 0, url: "about:debugging", title: "Debugging" });
assert.equal(calls.exec, 1);
assert.equal(new URL(calls.created[2].url).searchParams.get("url"), "about:debugging");

// back to "popup": the popup returns
store.local.resultsIn = "popup";
listeners.changed({ resultsIn: { newValue: "popup" } }, "local"); await tick();
assert.equal(calls.setPopup.at(-1), "popup.html");

// ---- container choice for the results tab ----
const last = () => calls.created.at(-1);
store.local.sources = {};
const tabInfo = { id: 20, index: 1, url: "https://getartcraft.com/", title: "ArtCraft" };

// option off: nothing is forced (Firefox then lets the tab inherit the page's container)
store.local.tabContainerOn = false; store.local.tabContainer = "firefox-container-3";
await listeners.clicked(tabInfo);
assert.equal(last().cookieStoreId, undefined);

// option on: the chosen container is used, whichever container the checked page is in
store.local.tabContainerOn = true;
await listeners.clicked(tabInfo);
assert.equal(last().cookieStoreId, "firefox-container-3");
assert.equal(last().openerTabId, 20); assert.equal(last().index, 2);

// "Default (no container)" is passed through explicitly, so it can't be overridden by inheritance
store.local.tabContainer = "firefox-default";
await listeners.clicked(tabInfo);
assert.equal(last().cookieStoreId, "firefox-default");

// private window: containers don't exist there, so the choice is skipped
await listeners.clicked({ ...tabInfo, incognito: true });
assert.equal(last().cookieStoreId, undefined);

// the chosen container was deleted (tabs.create rejects): fall back to a normal tab instead of failing silently
store.local.tabContainer = "firefox-container-99"; calls.failContainer = true;
const before = calls.created.length;
await listeners.clicked(tabInfo);
assert.equal(calls.created.length, before + 1);
assert.equal(last().cookieStoreId, undefined);
assert.ok(last().url.startsWith("moz-extension://abc/results.html?"));
console.log("background tests passed");
