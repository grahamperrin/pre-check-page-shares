import assert from "node:assert/strict";

// Issue #9: the page is x.com/..., but the Hacker News story was submitted as twitter.com/....
// Algolia only finds it when asked for the twitter.com spelling, and checkHackerNews sends just the first 3 queries.
const STORY = {
  objectID: "50047422", title: "The gap in shared understanding of LLM capability is widening",
  url: "https://twitter.com/karpathy/status/2109361546505966046", author: "albertzeyer",
  created_at: "2026-10-16T12:00:52Z", points: 10, num_comments: 3,
};

const asked = [];
globalThis.fetch = async (url) => {
  const u = new URL(url);
  assert.equal(u.hostname, "hn.algolia.com");
  const q = u.searchParams.get("query");
  asked.push(q);
  // Algolia matches the url field by words: only the twitter.com spelling finds this story.
  const hits = q.replace(/^www\./, "").startsWith("twitter.com/karpathy") ? [STORY] : [];
  return { ok: true, status: 200, json: async () => ({ hits }) };
};

const { checkHackerNews } = await import("../src/lib.js");

for (const page of [
  "https://x.com/karpathy/status/2109361546505966046",
  "https://x.com/karpathy/status/2109361546505966046?s=20&utm_source=share", // tracking noise must not push the sibling out
  "https://twitter.com/karpathy/status/2109361546505966046",
]) {
  asked.length = 0;
  const r = await checkHackerNews(page);
  assert.ok(asked.length <= 3, `at most 3 requests, got ${asked.length}`);
  assert.deepEqual(r.items.map((i) => i.url), ["https://news.ycombinator.com/item?id=50047422"], page);
  assert.equal(r.items[0].title, STORY.title);
  assert.ok(r.log.some((l) => /returned, 1 have this link$/.test(l)), r.log.join("\n"));
}

// A page on another site must not gain twitter.com queries.
asked.length = 0;
await checkHackerNews("https://example.com/a");
assert.ok(asked.every((q) => !q.includes("twitter.com") && !q.includes("x.com/")));
console.log("hacker news x/twitter tests passed");
