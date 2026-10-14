import assert from "node:assert/strict";
import { redditVariants, checkReddit } from "../src/lib.js";

// Variants: bare domain has two spellings; a www page gets the full host x slash matrix; http pages try https first.
assert.deepEqual(redditVariants("https://getartcraft.com/"), ["https://getartcraft.com/", "https://www.getartcraft.com/"]);
assert.deepEqual(redditVariants("https://www.eff.org/a/b/?utm_source=x#t"),
  ["https://www.eff.org/a/b/", "https://www.eff.org/a/b", "https://eff.org/a/b/", "https://eff.org/a/b"]);
assert.ok(redditVariants("http://example.com/x")[0].startsWith("https://"));

// Four posts, each submitted with a different spelling; Reddit matches the submitted string exactly.
const post = (id, url, extra = {}) => ({ data: { name: "t3_" + id, title: "ArtCraft " + id, url, permalink: `/r/x${id}/comments/${id}/t/`, subreddit: "x" + id, subreddit_name_prefixed: "r/x" + id, author: "u", created_utc: 1790000000 + id.length, score: 1, num_comments: 0, ...extra } });
const bySpelling = {
  "https://getartcraft.com/": [post("a", "https://getartcraft.com/")],
  "https://www.getartcraft.com/": [post("b", "https://www.getartcraft.com/"), post("c", "https://www.getartcraft.com"), post("d", "https://getartcraft.com/", { removed_by_category: "moderator" }), post("e", "https://other.example/unrelated")],
};
let calls = [];
globalThis.fetch = async (url, opts) => {
  const u = new URL(url); calls.push(u.searchParams.get("url"));
  assert.equal(u.pathname, "/api/info.json");
  assert.equal(opts.headers.Accept, "application/json");
  assert.equal(opts.credentials, "include");                       // always with reddit.com cookies; there is no cookie-less attempt
  return { ok: true, status: 200, json: async () => ({ data: { children: bySpelling[u.searchParams.get("url")] ?? [] } }) };
};
let r = await checkReddit("https://getartcraft.com/", undefined);
console.log(r.log);
assert.equal(r.items.length, 4);                                  // a, b, c, d(removed); e is unrelated
assert.ok(r.items.some((i) => i.community.includes("(removed)")));
assert.equal(calls.length, 2);
assert.equal(r.forbidden, false);

// Reported failure mode: HTTP 403 (e.g. no usable reddit.com cookies). One request, then stop, and say so.
calls = [];
globalThis.fetch = async (url) => { calls.push(url); return { ok: false, status: 403, json: async () => ({}) }; };
r = await checkReddit("https://www.eff.org/a/b/", undefined);
assert.equal(calls.length, 1);
assert.equal(r.ok, false);
assert.equal(r.forbidden, true);
assert.ok(r.log[0].endsWith("HTTP 403"));

// Rate limit: stop politely after the first 429.
calls = [];
globalThis.fetch = async (url) => { calls.push(url); return { ok: false, status: 429, json: async () => ({}) }; };
r = await checkReddit("https://www.eff.org/a/b/", undefined);
assert.equal(calls.length, 1);
assert.equal(r.forbidden, false);
assert.ok(r.log.some((l) => l.includes("rate-limiting")));
console.log("reddit tests passed");
