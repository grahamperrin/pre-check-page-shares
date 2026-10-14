import { JSDOM } from "jsdom";
import fs from "node:fs";
import assert from "node:assert/strict";

const DIR = new URL("../src/", import.meta.url);
const HTML = fs.readFileSync(new URL("results.html", DIR), "utf8").replace(/<script[^>]*><\/script>/, "").replace(/<link[^>]*>/, "");
const PAGE = "https://creativecommons.org/2026/09/21/a-principled-approach-as-the-sands-shift/";
const TITLE = "A Principled Approach as the Sands Shift";
const post = { id: "1", uri: "u1", url: "https://mastodon.social/@creativecommons/1", created_at: "2026-09-25T10:00:00Z", content: `<p><a href="${PAGE}">link</a></p>`,
  account: { acct: "creativecommons", username: "creativecommons", display_name: "Creative Commons" }, reblogs_count: 0, favourites_count: 0, replies_count: 0 };

let n = 0;
let downloads = [];
async function open(search, store) {
  const dom = new JSDOM(HTML, { url: "moz-extension://abc/results.html" + search });
  downloads = [];
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, download: this.download }); };
  Object.assign(globalThis, { document: dom.window.document, location: dom.window.location, window: dom.window, DOMParser: dom.window.DOMParser });
  const j = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.host === "hn.algolia.com") return j({ hits: [{ objectID: "9", title: "HN thread", url: PAGE, points: 3, num_comments: 1, created_at: "2026-09-22T00:00:00Z", author: "a" }] });
    if (u.host === "www.reddit.com") return j({}, 403);
    if (u.host === "lobste.rs") return j([]);
    if (u.pathname === "/api/v1/accounts/lookup") return j({ id: "1", username: "creativecommons" });
    if (u.pathname === "/api/v1/accounts/1/statuses") return j([post]);
    throw new TypeError("unexpected " + url);
  };
  globalThis.browser = {                                  // note: no scripting API at all, the results page must never need it
    storage: { local: { get: async () => store } },
    permissions: { contains: async () => true },
    runtime: { openOptionsPage() {} },
  };
  await import(`../src/results.js?n=${++n}`);
  for (let i = 0; i < 100 && dom.window.document.getElementById("summary").textContent === "Checking…"; i++) await new Promise((r) => setTimeout(r, 20));
  return dom.window.document;
}
const q = (o) => "?" + new URLSearchParams(o);
const heads = (d) => [...d.querySelectorAll(".host span")].map((x) => x.textContent);

// 1. normal case: candidates arrive in the address, theme forced dark by Settings
let d = await open(q({ url: PAGE, title: TITLE, c: JSON.stringify([{ acct: "creativecommons@mastodon.social", via: "profile link" }]) }), { tabTheme: "dark" });
assert.equal(d.documentElement.dataset.theme, "dark");
assert.equal(d.getElementById("title").textContent, TITLE);
assert.equal(d.title, `${TITLE} – pre-check page shares`);
assert.equal(d.getElementById("page").textContent, PAGE);
assert.equal(d.getElementById("summary").textContent, "Found 2 posts with this link");
assert.deepEqual(heads(d), ["Hacker News", "Mastodon · page's own account @creativecommons@mastodon.social"]);
assert.equal(d.getElementById("tally").textContent, "Hacker News 1 · Lobsters 0 · Mastodon 1");

// 1b. Save sits to the right of the headline, on the same line, and downloads Markdown
assert.deepEqual([...d.querySelector(".headline").children].map((x) => x.id), ["summary", "save"]);
assert.equal(d.getElementById("save").hidden, false);
d.getElementById("save").click();
assert.equal(downloads.length, 1);
assert.ok(downloads[0].download.startsWith("pre-check-a-principled-approach-as-the-sands-shift-") && downloads[0].download.endsWith(".md"));
const md = decodeURIComponent(downloads[0].href.slice(downloads[0].href.indexOf(",") + 1));
assert.ok(md.includes("## Hacker News") && md.includes("## Mastodon · page's own account @creativecommons@mastodon.social"));
assert.ok(md.includes("- Result: Found 2 posts with this link"));

// 2. theme "auto" (the default): no data-theme attribute, so CSS follows the system
d = await open(q({ url: PAGE, title: TITLE, c: "[]" }), {});
assert.equal(d.documentElement.dataset.theme, undefined);
assert.equal(d.getElementById("summary").textContent, "Found 1 post with this link");

// 3. a mangled address must not break the page
d = await open("?url=" + encodeURIComponent(PAGE) + "&c=%7Bnot-json", {});
assert.equal(d.getElementById("summary").textContent, "Found 1 post with this link");

// 4. nothing to check (restricted page / hand-typed address)
d = await open(q({ url: "about:debugging", title: "Debugging" }), {});
assert.equal(d.getElementById("summary").textContent, "Open a web page first.");
assert.equal(d.getElementById("save").hidden, true);                    // nothing was checked, nothing to save
d = await open("", {});
assert.equal(d.getElementById("title").textContent, "No page to check");

// 5. a different palette from the popup, as asked
const tab = fs.readFileSync(new URL("results.css", DIR), "utf8"), popup = fs.readFileSync(new URL("popup.css", DIR), "utf8");
assert.ok(!/#ffd54a/i.test(tab) && !/#7a5200/i.test(tab));
assert.ok(/#faf9f5/i.test(tab) && /#262624/i.test(tab));
assert.ok(/#ffd54a/i.test(popup) && !/6364ff/i.test(popup));

// 6. Reddit 403 in the results tab: the note names the container, and Settings as the way out
d = await open(q({ url: PAGE, title: TITLE, c: "[]" }), { sources: { hn: false, lobsters: false, reddit: true, publisher: false } });
const notes = [...d.querySelectorAll("#notes li")].map((x) => x.textContent);
assert.ok(notes.some((x) => x.startsWith("Reddit answered HTTP 403 (forbidden)") && x.includes("container the tab is open in")));
console.log("results page tests passed");
