import { JSDOM } from "jsdom";
import fs from "node:fs";
import assert from "node:assert/strict";
import { scanPage, pickCandidates } from "../src/lib.js";

const POPUP = fs.readFileSync(new URL("../src/popup.html", import.meta.url), "utf8").replace(/<script[^>]*><\/script>/, "");
const PAGE = "https://creativecommons.org/2026/09/21/a-principled-approach-as-the-sands-shift/";
const TITLE = "A Principled Approach as the Sands Shift - Creative Commons";
const LINK = `<p>Creative Commons has been exploring AI.</p><p><a href="${PAGE}"><span class="invisible">https://</span>creativecommons.org/…</a></p>`;
const mkStatus = (id, html) => ({ id, uri: `https://mastodon.social/users/cc/statuses/${id}`, url: `https://mastodon.social/@creativecommons/${id}`, created_at: "2026-09-25T10:00:00Z",
  content: html, account: { acct: "creativecommons", username: "creativecommons", display_name: "Creative Commons" }, reblogs_count: 1, favourites_count: 2, replies_count: 0 });
const ccPost = mkStatus("117333064187264129", LINK);

// ---------- scanPage + pickCandidates (page-side logic) ----------
{
  const d = new JSDOM(`<head><meta name="fediverse:creator" content="@author@hachyderm.io"></head><body>
    <a rel="me noopener" href="https://fosstodon.org/@pub">me</a>
    <a href="https://mastodon.social/@creativecommons">footer</a>
    <a href="https://medium.com/@someone">not mastodon</a>
    <a href="http://insecure.example/@nope">http</a>
    <a href="https://example.org/about">other</a>
    <a href="https://mastodon.social/@creativecommons/">dup</a></body>`);
  globalThis.document = d.window.document;
  const raw = scanPage();
  const picked = pickCandidates(raw);
  console.log(picked);
  assert.deepEqual(picked.map((c) => c.acct), ["author@hachyderm.io", "pub@fosstodon.org", "creativecommons@mastodon.social"]);
  assert.deepEqual(picked.map((c) => c.via), ["fediverse:creator", "rel=me", "profile link"]);
}

// ---------- popup, end to end ----------
let runNo = 0;
async function run({ store, redditFails = false, searchHasPost = false }) {
  const dom = new JSDOM(POPUP);
  const downloads = [];                                       // what "Save" tries to download
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, download: this.download }); };
  const requests = [];
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, location: dom.window.location, DOMParser: dom.window.DOMParser });
  const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    requests.push({ host: u.host, path: u.pathname, auth: opts.headers?.Authorization, credentials: opts.credentials });
    if (u.host === "hn.algolia.com") return json({ hits: [{ objectID: "4242", title: "A Principled Approach", url: PAGE, points: 7, num_comments: 3, created_at: "2026-09-22T08:00:00Z", author: "bob" }, { objectID: "9", url: "https://creativecommons.org/other", title: "x" }] });
    if (u.host === "lemmy.world") return json({ posts: [{ post: { id: 77, name: "CC on AI", url: PAGE, ap_id: "https://lemmy.world/post/77", published: "2026-09-23T08:00:00Z" }, creator: { name: "carol" }, community: { name: "technology" }, counts: { score: 12, comments: 4 } }] });
    if (u.host === "lobste.rs") return json([{ short_id: "abc123", title: "Principled approach", comments_url: "https://lobste.rs/s/abc123/principled", submitter_user: "dave", score: 5, comment_count: 2, created_at: "2026-09-24T08:00:00Z", tags: ["ai", "law"] }]);
    if (u.host === "www.reddit.com") {
      assert.equal(u.pathname, "/api/info.json");                                                  // the only endpoint used now
      if (redditFails) return json({}, 403);
      const hit = u.searchParams.get("url") === PAGE;                                              // Reddit matches the exact spelling
      return json({ data: { children: hit ? [{ data: { name: "t3_a", title: "CC thoughts", url: PAGE, permalink: "/r/opensource/comments/a/cc/", subreddit_name_prefixed: "r/opensource", author: "erin", created_utc: 1790000000, score: 30, num_comments: 9 } }] : [] } });
    }
    if (u.host === "mastodon.social") {
      if (u.pathname === "/api/v1/timelines/link") return json({}, 404);
      if (u.pathname === "/api/v2/search") return json({ statuses: searchHasPost && !u.searchParams.get("q").startsWith('"') ? [ccPost] : [] });
      if (u.pathname === "/api/v1/accounts/lookup") return json({ id: "1", username: "creativecommons" });
      if (u.pathname === "/api/v1/accounts/1/statuses") {
        return json(u.searchParams.get("max_id") ? [ccPost] : [mkStatus("3", "<p>unrelated</p>"), mkStatus("2", "<p>also unrelated</p>")]);
      }
    }
    throw new TypeError("NetworkError when attempting to fetch resource.");
  };
  globalThis.browser = {
    tabs: { query: async () => [{ id: 1, url: PAGE, title: TITLE }] },
    scripting: { executeScript: async () => [{ result: [{ acct: "creativecommons@mastodon.social", via: "profile link" }, { acct: "someone@medium.com", via: "profile link" }] }] },
    storage: { local: { get: async () => store } },
    permissions: { contains: async () => true },
    runtime: { openOptionsPage() {} },
  };
  await import(`../src/popup.js?run=${++runNo}`);
  for (let i = 0; i < 100 && dom.window.document.getElementById("summary").textContent === "Checking…"; i++) await new Promise((r) => setTimeout(r, 20));
  const d = dom.window.document;
  return {
    d, requests, downloads, summary: d.getElementById("summary").textContent, tally: d.getElementById("tally").textContent,
    headers: [...d.querySelectorAll(".host span")].map((x) => x.textContent), notes: [...d.querySelectorAll("#notes li")].map((x) => x.textContent),
    log: d.getElementById("log").textContent,
  };
}

const store = { instances: [{ host: "mastodon.social", token: "TOKEN" }], lemmyHosts: ["lemmy.world"], sources: { hn: true, lobsters: true, reddit: true, publisher: true } };

// A: the Creative Commons case. Search can't see the post, but the page's own account has it.
let r = await run({ store });
console.log(r.summary, "|", r.tally); console.log(r.headers); console.log(r.log);
assert.equal(r.summary, "Found 5 posts with this link");
assert.equal(r.tally, "Hacker News 1 · Lemmy 1 · Lobsters 1 · Mastodon 1 · Reddit 1");
assert.deepEqual(r.headers, ["Hacker News", "Lemmy · lemmy.world", "Lobsters", "Mastodon · mastodon.social", "Mastodon · page's own account @creativecommons@mastodon.social", "Reddit"]);
assert.ok(r.requests.filter((q) => q.host !== "www.reddit.com").every((q) => q.credentials === "omit")); // no cookies anywhere...
assert.ok(r.requests.filter((q) => q.host === "www.reddit.com").every((q) => q.credentials === "include")); // ...except Reddit, by design
const acct = r.requests.filter((q) => q.path.startsWith("/api/v1/accounts/"));
assert.ok(acct.length >= 2 && acct.every((q) => q.auth === undefined));                              // never send the token to page-supplied hosts
assert.ok(r.requests.filter((q) => q.path === "/api/v2/search").every((q) => q.auth === "Bearer TOKEN"));
assert.ok(!r.requests.some((q) => q.host === "medium.com"));                                         // non-Mastodon profile never contacted
assert.ok(r.d.querySelector(".post a, a.post").href.includes("news.ycombinator.com/item?id=4242"));
assert.ok(!r.log.includes("TOKEN"));

// A2: Save sits midway along the foot: Details | Save | Settings, and writes what is on screen as Markdown.
assert.deepEqual([...r.d.querySelectorAll(".bar > *")].map((x) => x.id), ["details-toggle", "save", "settings"]);
const logEl = r.d.getElementById("log"), tog = r.d.getElementById("details-toggle");
assert.equal(tog.hidden, false); assert.equal(logEl.hidden, true);                       // the log stays collapsed until asked for
tog.click(); assert.equal(logEl.hidden, false); assert.equal(tog.getAttribute("aria-expanded"), "true");
tog.click(); assert.equal(logEl.hidden, true); assert.equal(tog.getAttribute("aria-expanded"), "false");
const saveBtn = r.d.getElementById("save");
assert.equal(saveBtn.hidden, false);
saveBtn.click();
assert.equal(r.downloads.length, 1);
assert.match(r.downloads[0].download, /^pre-check-a-principled-approach-as-the-sands-shift-.*-\d{4}-\d{2}-\d{2}\.md$/);
assert.ok(r.downloads[0].href.startsWith("data:text/markdown;charset=utf-8,"));
const md = decodeURIComponent(r.downloads[0].href.slice(r.downloads[0].href.indexOf(",") + 1));
const pos = ["## Hacker News", "## Lemmy · lemmy.world", "## Lobsters", "## Mastodon · page's own account @creativecommons@mastodon.social", "## Reddit"].map((h) => md.indexOf(h));
assert.ok(pos.every((p) => p > 0) && pos.every((p, i) => i === 0 || p > pos[i - 1]));  // every source present, in alphabetical order
assert.ok(md.includes("- Result: Found 5 posts with this link"));
assert.ok(md.includes("- Places: Hacker News 1 · Lemmy 1 · Lobsters 1 · Mastodon 1 · Reddit 1"));
assert.ok(md.includes("](https://news.ycombinator.com/item?id=4242)"));
assert.ok(!md.includes("TOKEN"));                                                         // the token never reaches the file

// B: dedupe. The same post also comes back from the server's own search; it must count once.
r = await run({ store, searchHasPost: true });
assert.equal(r.summary, "Found 5 posts with this link");
assert.ok(!r.headers.some((h) => h.includes("page's own account")));

// C: Reddit refuses everything: marked failed, others unaffected, and the user is told what the cross means.
r = await run({ store, redditFails: true });
assert.equal(r.tally, "Hacker News 1 · Lemmy 1 · Lobsters 1 · Mastodon 1 · Reddit ✕");
assert.equal(r.summary, "Found 4 posts with this link");
assert.ok(r.notes.some((n) => n.startsWith("✕ means")));
assert.ok(r.notes.some((n) => n.startsWith("Reddit answered HTTP 403 (forbidden)")));

// D: nothing configured except defaults, no token: honest message, no pretence of a clean result.
r = await run({ store: { instances: [{ host: "mastodon.social", token: "" }], sources: { hn: false, lobsters: false, reddit: false, publisher: false } } });
console.log(r.summary, "|", r.tally);
assert.equal(r.summary, "Can't search Mastodon without a token");
assert.equal(r.tally, "Mastodon: token needed");
assert.equal(r.d.getElementById("save").hidden, false);

// F: nothing switched on, nothing checked: nothing to save.
r = await run({ store: { instances: [], sources: { hn: false, lobsters: false, reddit: false, publisher: false } } });
assert.equal(r.summary, "Nothing is switched on.");
assert.equal(r.d.getElementById("save").hidden, true);
assert.equal(r.d.getElementById("details-toggle").hidden, true);

// E: Reddit left at its default (off): not contacted at all, and absent from the tally.
r = await run({ store: { ...store, sources: { hn: true, lobsters: true, publisher: true } } });
assert.ok(!r.requests.some((q) => q.host === "www.reddit.com"));
assert.ok(!r.tally.includes("Reddit"));
assert.equal(r.summary, "Found 4 posts with this link");
console.log("popup flow tests passed");
