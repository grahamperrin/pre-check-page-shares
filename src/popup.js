import { scanPage } from "./lib.js";
import { run } from "./ui.js";

document.getElementById("settings").addEventListener("click", (e) => { e.preventDefault(); browser.runtime.openOptionsPage(); window.close(); });

const toggle = document.getElementById("details-toggle");
const log = document.getElementById("log");
toggle.addEventListener("click", () => { log.hidden = !log.hidden; toggle.setAttribute("aria-expanded", String(!log.hidden)); });

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
run({
  url: tab?.url,
  title: tab?.title,
  scan: async () => (await browser.scripting.executeScript({ target: { tabId: tab.id }, func: scanPage }))[0]?.result ?? [],
});
