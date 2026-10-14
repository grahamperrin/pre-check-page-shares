import assert from "node:assert/strict";
import { buildMarkdown, markdownFilename, localStamp } from "../src/markdown.js";

const when = new Date(2026, 9, 14, 8, 5);      // 2026-10-14 08:05 local
assert.equal(localStamp(when), "2026-10-14 08:05");

const md = buildMarkdown({
  url: "https://example.com/a (b)/c d?x=1&y=<2>",
  title: "Title with [brackets], *stars*, _under_, `ticks`, <tags> and a | pipe\nand a line break",
  checkedAt: when,
  summary: "Found 2 posts with this link",
  tally: "Hacker News 1 · Mastodon 1",
  sections: [
    { title: "Hacker News", rows: [{ title: "Evil [x](http://bad) title", url: "https://news.ycombinator.com/item?id=1", meta: "by bob · 22/09/2026", stats: "▲ 7   💬 3" }] },
    { title: "Mastodon · mastodon.social", rows: [{ title: "Creative Commons", url: "https://mastodon.social/@cc/1", meta: "@cc · 25/09/2026", stats: "↻ 1  ★ 2  ↩ 0", excerpt: "Line one\n\nline *two* " + "x".repeat(400) }] },
  ],
  notes: ["✕ means every request failed.", "A *note* with _marks_"],
  generator: "pre-check page shares 0.6.0",
});
console.log(md);

// structure and order
const at = (s) => md.indexOf(s);
assert.ok(md.startsWith("# Pre-check: "));
assert.ok(at("## Hacker News") > 0 && at("## Hacker News") < at("## Mastodon · mastodon.social") && at("## Mastodon · mastodon.social") < at("## Notes"));
assert.ok(md.includes("- Checked: 2026-10-14 08:05"));
assert.ok(md.includes("- Result: Found 2 posts with this link"));
assert.ok(md.includes("- Places: Hacker News 1 · Mastodon 1"));
assert.ok(md.endsWith("_Saved by pre-check page shares 0.6.0._\n"));

// other people's text can't inject Markdown or HTML
assert.ok(md.includes("# Pre-check: Title with \\[brackets\\], \\*stars\\*, \\_under\\_, \\`ticks\\`, \\<tags\\> and a \\| pipe and a line break"));
assert.ok(md.includes("- [Evil \\[x\\](http://bad) title](https://news.ycombinator.com/item?id=1)"));   // brackets escaped: no second link
assert.ok(!md.includes("<tags>") && !md.includes("<2>"));
// URLs with spaces/parentheses/angle brackets are made safe in both places they appear
assert.ok(md.includes("- Page: <https://example.com/a%20%28b%29/c%20d?x=1&y=%3C2%3E>"));
// excerpts are flattened and capped; one blockquote line, never multi-line
const quote = md.split("\n").filter((l) => l.startsWith("  > "));
assert.equal(quote.length, 1);
assert.ok(quote[0].endsWith("…") && quote[0].length < 300);
assert.ok(quote[0].includes("Line one line \\*two\\*"));
assert.ok(md.includes("- A \\*note\\* with \\_marks\\_"));

// nothing found: still a valid, useful record
const empty = buildMarkdown({ url: "https://example.com/", title: "", checkedAt: when, summary: "No matches found", tally: "Hacker News 0", sections: [], notes: [] });
assert.ok(empty.startsWith("# Pre-check: https://example.com/"));
assert.ok(!empty.includes("## ") && !empty.includes("Notes"));
assert.ok(empty.includes("_Saved by pre-check page shares._"));

// filenames
const f = (o) => markdownFilename({ checkedAt: when, ...o });
assert.equal(f({ title: "A Principled Approach as the Sands Shift - Creative Commons", url: "https://creativecommons.org/x" }), "pre-check-a-principled-approach-as-the-sands-shift-creative-2026-10-14.md");
assert.equal(f({ title: "", url: "https://www.getartcraft.com/" }), "pre-check-getartcraft-com-2026-10-14.md");     // falls back to the host
assert.equal(f({ title: "///???", url: "not a url" }), "pre-check-results-2026-10-14.md");                                    // nothing usable
assert.equal(f({ title: "Türkiye: LGBTQ+ / 検閲?", url: "https://x.test/" }), "pre-check-türkiye-lgbtq-検閲-2026-10-14.md");  // letters kept, punctuation and slashes removed
assert.ok(!/[\\/:*?"<>|]/.test(f({ title: 'a/b\\c:d*e?f"g<h>i|j', url: "https://x.test/" })));
console.log("markdown tests passed");
