import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
globalThis.DOMParser = new JSDOM().window.DOMParser;
globalThis.browser = { permissions: { contains: async () => true } };

const PAGE = "https://www.eff.org/deeplinks/2026/10/congress-has-another-site-blocking-bill-and-one-targets-vpns?utm_source=feed";
const post = (id, html) => ({ id, uri: `https://mastodon.social/users/x/statuses/${id}`, url: `https://mastodon.social/@x/${id}`, created_at: "2026-10-10T10:00:00Z",
  content: html, account: { acct: "x", username: "x", display_name: "X" }, reblogs_count: 0, favourites_count: 0, replies_count: 0 });
// Mastodon renders links with invisible/ellipsis spans; href holds the full URL.
const withLink = post(1, '<p>Congress Has Another Site-Blocking Bill<br><a href="https://www.eff.org/deeplinks/2026/10/congress-has-another-site-blocking-bill-and-one-targets-vpns"><span class="invisible">https://www.</span><span class="ellipsis">eff.org/deeplinks/2026/10/co</span></a></p>');
const titleOnly = post(2, "<p>Congress Has Another Site-Blocking Bill, And This One Targets VPNs (via shortener https://bit.ly/xyz)</p>");
const unrelated = post(3, '<p>cats <a href="https://eff.org/other">link</a></p>');

const seen = [];
globalThis.fetch = async (url, opts) => {
  const u = new URL(url); seen.push(u.pathname + "?" + decodeURIComponent(u.searchParams.get("q") ?? u.searchParams.get("url") ?? ""));
  const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
  if (u.pathname === "/api/v1/timelines/link") return json({ error: "Record not found" }, 404);
  const q = u.searchParams.get("q");
  assert.equal(opts.headers.Authorization, "Bearer TOKEN");
  assert.equal(u.searchParams.get("resolve"), "false");
  if (q.startsWith("http")) return json({ statuses: [] });                      // scheme queries find nothing (as observed)
  if (q.includes("eff.org/deeplinks")) return json({ statuses: [withLink, unrelated] });
  if (q.startsWith('"Congress')) { assert.ok(q.endsWith('"')); return json({ statuses: [withLink, titleOnly] }); }
  return json({ statuses: [] });
};

const { checkInstance } = await import("../src/lib.js");
const r = await checkInstance({ host: "mastodon.social", token: "TOKEN" }, { url: PAGE, title: "Congress Has Another Site-Blocking Bill, And This One Targets VPNs | Electronic Frontier Foundation" });
console.log(seen);
assert.deepEqual(r.statuses.map((s) => s.id), [1]);          // link match kept, unrelated filtered out
assert.deepEqual(r.titleStatuses.map((s) => s.id), [2]);     // title-only match separated, link match not duplicated
assert.deepEqual(r.notes, []);                                // 404 on link timeline is silent
// diagnostics log: one line per request, deterministic order, no token
assert.equal(r.log.length, 7);
assert.match(r.log[0], /^link timeline for .* → HTTP 404$/);
assert.ok(r.log.some((l) => /^search www\.eff\.org\/deeplinks.* → 2 returned, 1 contain the link$/.test(l)));
assert.ok(r.log.some((l) => /^title search "Congress Has Another.* → 2 returned, 1 contain the link$/.test(l)));
assert.ok(r.log.every((l) => !l.includes("TOKEN") && !l.includes("…")));
console.log(r.log.join("\n"));

// No token: skips search, says so.
const r2 = await checkInstance({ host: "mastodon.social", token: "" }, { url: PAGE, title: "x" });
assert.equal(r2.searched, false); assert.match(r2.notes[0], /no access token/);

// Network failure: message names the endpoint instead of a bare "NetworkError".
globalThis.fetch = async () => { throw new TypeError("NetworkError when attempting to fetch resource."); };
const r3 = await checkInstance({ host: "mastodon.social", token: "" }, { url: PAGE, title: "x" });
console.log(r3.notes);
assert.ok(r3.notes.some((n) => n.includes("/api/v1/timelines/link")));
console.log("e2e passed");

// Regression (Creative Commons case): the post has the link but isn't found by URL search (e.g. author not indexable).
// If a title search happens to return it, it must be classed as a LINK match, not "same title only".
const ccPage = "https://creativecommons.org/2026/09/21/a-principled-approach-as-the-sands-shift/";
const ccPost = post(4, '<p>Creative Commons has been exploring AI. A Principled Approach as the Sands Shift<br><a href="https://creativecommons.org/2026/09/21/a-principled-approach-as-the-sands-shift/">link</a></p>');
globalThis.fetch = async (url) => {
  const u = new URL(url); const q = u.searchParams.get("q");
  const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
  if (u.pathname === "/api/v1/timelines/link") return json({}, 404);
  if (q && q.startsWith('"A Principled')) return json({ statuses: [ccPost, unrelated] });
  return json({ statuses: [] });                        // URL searches find nothing
};
const r4 = await checkInstance({ host: "mastodon.social", token: "T" }, { url: ccPage, title: "A Principled Approach as the Sands Shift - Creative Commons" });
assert.deepEqual(r4.statuses.map((s) => s.id), [4]);
assert.deepEqual(r4.titleStatuses.map((s) => s.id), [3]);   // unrelated title-only hit stays in the secondary list
console.log("regression passed");

// Issue #8: page is x.com/..., the Mastodon post links twitter.com/... and only a twitter.com search finds it.
{
  const xPage = "https://x.com/karpathy/status/2109361546505966046";
  const bot = post(5, '<p>Karpathy on X <a href="https://twitter.com/karpathy/status/2109361546505966046"><span class="invisible">https://</span><span class="ellipsis">twitter.com/karpathy/status/21</span><span class="invisible">09361546505966046</span></a></p>');
  globalThis.fetch = async (url) => {
    const u = new URL(url); const q = u.searchParams.get("q");
    const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (u.pathname === "/api/v1/timelines/link") return json({}, 404);
    return json({ statuses: q.startsWith("twitter.com/karpathy") ? [bot] : [] });
  };
  const rx = await checkInstance({ host: "mastodon.social", token: "TOKEN" }, { url: xPage, title: "x" });
  assert.deepEqual(rx.statuses.map((s) => s.id), [5]);
  console.log("issue #8 e2e passed");
}
