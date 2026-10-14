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

// Tab mode: the click is the only moment the extension may look at the page (activeTab), so read it now,
// then open the results page with what it needs in its address.
browser.action.onClicked.addListener(async (tab) => {
  const { sources, tabContainerOn, tabContainer } = await browser.storage.local.get(["sources", "tabContainerOn", "tabContainer"]);
  let candidates = [];
  if ((sources?.publisher ?? true) && tab.id != null && /^https?:/.test(tab.url ?? "")) {
    try { candidates = pickCandidates((await browser.scripting.executeScript({ target: { tabId: tab.id }, func: scanPage }))[0]?.result ?? []); }
    catch { /* restricted pages can't be scanned */ }
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
});
