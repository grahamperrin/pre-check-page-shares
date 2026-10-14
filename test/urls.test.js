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
