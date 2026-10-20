import { linkKey, urlQueries, titleQuery } from "../src/lib.js";
import assert from "node:assert/strict";
const k = linkKey;
assert.equal(k("https://www.Example.com/a/b/?utm_source=x&id=2&b=1#frag"), k("http://example.com/a/b?b=1&id=2"));
assert.equal(k("https://example.com"), k("https://example.com/"));
assert.notEqual(k("https://example.com/a"), k("https://example.com/b"));
assert.equal(k("not a url"), null);

// The exact page from the bug report: scheme-less, host with and without www.
const eff = "https://www.eff.org/deeplinks/2026/10/congress-has-another-site-blocking-bill-and-one-targets-vpns";
const q = urlQueries(eff);
console.log(q);
assert.ok(q.includes("www.eff.org/deeplinks/2026/10/congress-has-another-site-blocking-bill-and-one-targets-vpns"));
assert.ok(q.includes("eff.org/deeplinks/2026/10/congress-has-another-site-blocking-bill-and-one-targets-vpns"));
assert.ok(q.every((x) => !x.includes("http") && !x.includes(":")));
console.log(urlQueries("https://example.com:8080/a/?utm_source=x&id=2#top"));
assert.ok(urlQueries("https://example.com:8080/a?id=2").every((x) => !x.includes(":")));

console.log(titleQuery("Congress Has Another Site-Blocking Bill, And This One Targets VPNs | Electronic Frontier Foundation"));
console.log(titleQuery('Foo: "bar" baz - Site'));
assert.equal(titleQuery("Home"), null);
console.log("all asserts passed");

// Issue #8: x.com and twitter.com are the same site. A Mastodon bot post linked twitter.com/... for a page opened as x.com/...
const xPage = "https://x.com/karpathy/status/2109361546505966046";
assert.equal(k(xPage), k("https://twitter.com/karpathy/status/2109361546505966046"));
assert.equal(k(xPage), k("https://www.twitter.com/karpathy/status/2109361546505966046/"));
assert.equal(k(xPage), k("https://mobile.twitter.com/karpathy/status/2109361546505966046"));
assert.notEqual(k(xPage), k("https://x.com/karpathy/status/1"));
assert.notEqual(k("https://example.com/a"), k("https://twitter.com/a"));
const xq = urlQueries(xPage);
assert.ok(xq.includes("x.com/karpathy/status/2109361546505966046"));
assert.ok(xq.includes("twitter.com/karpathy/status/2109361546505966046"), "search must also try the twitter.com spelling");
assert.ok(urlQueries("https://twitter.com/a/status/1").includes("x.com/a/status/1"));
assert.ok(urlQueries("https://example.com/a").every((x) => !x.includes("twitter.com")));
console.log("x/twitter asserts passed");

// X share links add ?s=20 / ?t=…&s=19; that is noise on X/Twitter only.
assert.equal(k("https://x.com/karpathy/status/2109361546505966046?s=20"), k(xPage));
assert.equal(k("https://twitter.com/karpathy/status/2109361546505966046?t=abc&s=19"), k(xPage));
assert.notEqual(k("https://example.com/a?s=20"), k("https://example.com/a"));
assert.notEqual(k("https://example.com/a?t=1"), k("https://example.com/a"));
console.log("x share-param asserts passed");
