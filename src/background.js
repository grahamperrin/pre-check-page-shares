import { pickCandidates, scanPage } from "./lib.js";

// Where results appear is a setting: the toolbar popup (default) or a new tab. A toolbar button can only
// fire onClicked when it has no popup, so the popup is switched on or off here to match the setting.
// (The browser forgets this at shutdown, hence applying it on every start and every wake-up.)
async function applyMode() {
  const { resultsIn = "popup" } = await browser.storage.local.get("resultsIn");
  await browser.action.setPopup({ popup: resultsIn === "tab" ? "" : "popup.html" });
}
applyMode();
browser.runtime.onStartup.addListener(applyMode);
browser.runtime.onInstalled.addListener(applyMode);
browser.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.resultsIn) applyMode(); });

// Opens the results page for a tab, next to it. Used by the toolbar click (tab mode) and by the popup's
// "Check again in a results tab" button. `candidates` (Fediverse profiles found on the page) may already be known.
async function openResults(tab, candidates) {
  const { sources, tabContainerOn, tabContainer } = await browser.storage.local.get(["sources", "tabContainerOn", "tabContainer"]);
  if (!candidates) {
    candidates = [];
    // The click is the only moment the extension may look at the page (activeTab), so read it now.
    if ((sources?.publisher ?? true) && tab.id != null && /^https?:/.test(tab.url ?? "")) {
      try { candidates = pickCandidates((await browser.scripting.executeScript({ target: { tabId: tab.id }, func: scanPage }))[0]?.result ?? []); }
      catch { /* restricted pages can't be scanned */ }
    }
  }
  const params = new URLSearchParams({ url: tab.url ?? "", title: tab.title ?? "", c: JSON.stringify(candidates) });
  const create = { url: `${browser.runtime.getURL("results.html")}?${params}`, index: tab.index + 1, openerTabId: tab.id };

  // A tab opened next to another one inherits its container (Firefox treats it as "related"), and Reddit lookups
  // use the cookies of the container the results page runs in. An explicit container choice overrides that.
  // Containers don't exist in private windows, so the choice is skipped there.
  if (tabContainerOn && tabContainer && !tab.incognito) create.cookieStoreId = tabContainer;
  try {
    await browser.tabs.create(create);
  } catch (e) {
    if (!create.cookieStoreId) throw e;
    delete create.cookieStoreId; // e.g. the chosen container was deleted: fall back to the normal behaviour
    await browser.tabs.create(create);
  }
}

// Tab mode: the toolbar button has no popup, so a click arrives here.
browser.action.onClicked.addListener((tab) => openResults(tab));

// The popup runs outside any container, so it can't use Reddit cookies that live in one. It asks for the
// same check in a results tab instead, which can open in the container chosen in Settings.
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "open-results-tab" || sender.id !== browser.runtime.id) return;
  const t = msg.tab ?? {};
  return openResults({ id: t.id, index: t.index ?? 0, url: t.url, title: t.title, incognito: t.incognito }, Array.isArray(msg.candidates) ? msg.candidates : undefined);
});
