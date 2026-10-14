import { run } from "./ui.js";

// Opened by the background script with the page to check in the address: ?url=&title=&c=<profile candidates>.
// Reloading this tab simply checks again.
const q = new URLSearchParams(location.search);
const url = q.get("url") ?? "";
const title = q.get("title") ?? "";
let candidates = [];
try { candidates = JSON.parse(q.get("c") ?? "[]"); } catch { /* ignore a mangled address */ }

const { tabTheme = "auto" } = await browser.storage.local.get("tabTheme");
if (tabTheme === "light" || tabTheme === "dark") document.documentElement.dataset.theme = tabTheme;

document.title = title ? `${title} – pre-check page shares` : "pre-check page shares";
document.getElementById("title").textContent = title || url || "No page to check";
document.getElementById("settings").addEventListener("click", (e) => { e.preventDefault(); browser.runtime.openOptionsPage(); });

run({ url, title, scan: async () => candidates });
