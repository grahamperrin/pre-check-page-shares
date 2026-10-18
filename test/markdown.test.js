import assert from "node:assert/strict";
import { buildMarkdown, markdownFilename, localStamp } from "../src/markdown.js";

const when = new Date(2026, 9, 14, 8, 5);      // 2026-10-14 08:05 local
assert.equal(localStamp(when), "2026-10-14 08:05");

// ---- Issue #3 and issue #2: the exact post from the bug reports, in the exact layout asked for ----
const raster = {
  title: "Raster", url: "https://retro-gaiden.com/@raster/117446125715303744",
  handle: { text: "@raster@retro-gaiden.com", url: "https://retro-gaiden.com/@raster" },
  meta: "15/10/2026", stats: "↻ 0  ★ 0  ↩ 1",
  excerpt: "I also hope this mean NetBSD is going to get better support for the linux compatibility subsystem, that would help greatly to get running software that doesn't get ported, and hardware support. https://www.theregister.com/os-platforms/2026/10/13/netbsd-may-have-found-a-new-role-th",
};
const reported = buildMarkdown({ url: "https://example.com/", title: "x", checkedAt: when, sections: [{ title: "Mastodon · beige.party", rows: [raster] }] });
assert.ok(reported.includes(`### Mastodon · beige.party

**[Raster](https://retro-gaiden.com/@raster/117446125715303744)**

- [@raster@retro-gaiden.com](https://retro-gaiden.com/@raster) · 15/10/2026 · ↻ 0 ★ 0 ↩ 1

> I also hope this mean NetBSD is going to get better support for the linux compatibility subsystem, that would help greatly to get running software that doesn't get ported, and hardware support. https://www.theregister.com/os-platforms/2026/10/13/netbsd-may-have-found-a-new-role-th
`), reported);

// ---- a fuller document ----
const md = buildMarkdown({
  url: "https://example.com/a (b)/c d?x=1&y=<2>",
  title: "Title with [brackets], *stars*, _under_, `ticks`, <tags> and a | pipe\nand a line break",
  checkedAt: when,
  summary: "Found 2 posts with this link",
  tally: "Hacker News 1 · Mastodon 1",
  sections: [
    { title: "Hacker News", rows: [{ title: "Evil [x](http://bad) title", url: "https://news.ycombinator.com/item?id=1", meta: "by bob · 22/09/2026", stats: "▲ 7   💬 3" }] },
    { title: "Mastodon · page's own account @creativecommons@mastodon.social", rows: [{ title: "Creative Commons", url: "https://mastodon.social/@cc/1", handle: { text: "@cc", url: "https://mastodon.social/@cc" }, meta: "25/09/2026", stats: "↻ 1  ★ 2  ↩ 0", excerpt: "Line one\n\nline *two* thanks @raster@retro-gaiden.com and mail me@example.com" }] },
  ],
  notes: ["Also checked the page's own account: @creativecommons@mastodon.social, @a_b@host.example", "A *note* with _marks_"],
  generator: "pre-check page shares 0.6.1",
});
console.log(md);
const at = (s) => md.indexOf(s);
assert.ok(md.startsWith("## Pre-check: "));
assert.ok(at("### Hacker News") > 0 && at("### Hacker News") < at("### Mastodon") && at("### Mastodon") < at("### Notes"));
assert.ok(md.includes("- Checked: 2026-10-14 08:05"));
assert.ok(md.includes("- Result: Found 2 posts with this link"));
assert.ok(md.includes("- Places: Hacker News 1 · Mastodon 1"));
assert.ok(md.endsWith("_Saved by pre-check page shares 0.6.1._\n"));

// Issue #3: nothing is indented, and every quote and every bullet is its own block, flush left, after a blank line
const lines = md.split("\n");
assert.ok(lines.every((l) => !/^\s/.test(l)), "no line may start with whitespace");
lines.forEach((l, i) => { if (l.startsWith("> ") || (i > 6 && l.startsWith("- ") && lines[i - 1].trim() !== "" && !lines[i - 1].startsWith("- "))) assert.equal(lines[i - 1], "", `block before line ${i + 1} must be blank`); });
// one bullet per post, quote after it, never a quote inside a list
assert.ok(md.includes("**[Creative Commons](https://mastodon.social/@cc/1)**\n\n- [@cc](https://mastodon.social/@cc) · 25/09/2026 · ↻ 1 ★ 2 ↩ 0\n\n> Line one line"));

// Issue #2: no bare Fediverse handle survives anywhere; each one is written as an explicit link
const withoutLinks = md.replace(/\[[^\]]*(?:\\\][^\]]*)*\]\([^)]*\)/g, "");
assert.ok(!/@[\w.-]+@[\w.-]+\.[a-z]{2,}/i.test(withoutLinks), withoutLinks);
assert.ok(md.includes("### Mastodon · page's own account [@creativecommons@mastodon.social](https://mastodon.social/@creativecommons)"));   // heading
assert.ok(md.includes("thanks [@raster@retro-gaiden.com](https://retro-gaiden.com/@raster) and mail me@example.com"));                    // excerpt; a plain email is left alone
assert.ok(md.includes("- Also checked the page's own account: [@creativecommons@mastodon.social](https://mastodon.social/@creativecommons), [@a\\_b@host.example](https://host.example/@a_b)"));   // notes

// other people's text can't inject Markdown or HTML
assert.ok(md.includes("## Pre-check: Title with \\[brackets\\], \\*stars\\*, \\_under\\_, \\`ticks\\`, \\<tags\\> and a \\| pipe and a line break"));
assert.ok(md.includes("**[Evil \\[x\\](http://bad) title](https://news.ycombinator.com/item?id=1)**"));   // brackets escaped: no second link
assert.ok(!md.includes("<tags>") && !md.includes("<2>"));
assert.ok(md.includes("- Page: <https://example.com/a%20%28b%29/c%20d?x=1&y=%3C2%3E>"));
assert.ok(md.includes("- A \\*note\\* with \\_marks\\_"));

// ---- web addresses in quotes: left alone (an escaped underscore would break the link), never cut in half ----
const urlMd = buildMarkdown({ url: "https://x.test/", title: "t", checkedAt: when, sections: [{ title: "S", rows: [{ title: "T", url: "https://x.test/1",
  excerpt: "see https://example.com/a_b_c?x=1&y=2. And (https://example.com/d_e) too" }] }] });
assert.ok(urlMd.includes("> see https://example.com/a_b_c?x=1&y=2. And (https://example.com/d_e) too"), urlMd);

const longUrl = "https://example.com/" + "segment_".repeat(12) + "end";
const longMd = buildMarkdown({ url: "https://x.test/", title: "t", checkedAt: when, sections: [{ title: "S", rows: [{ title: "T", url: "https://x.test/1",
  excerpt: "word ".repeat(90) + longUrl + " tail" }] }] });   // 450 characters of words, then a URL that straddles the 500 limit
const quote = longMd.split("\n").find((l) => l.startsWith("> "));
assert.ok(quote.endsWith("…") && quote.length < 510, quote);
assert.ok(!/https:\/\/\S*$/.test(quote.slice(0, -1)) || quote.includes(longUrl), "a URL must be whole or absent");   // the URL straddles the limit: it is dropped, not chopped
assert.ok(!quote.includes("https://example.com/segment"), quote);

// ---- a row with nothing but a title and link ----
const bare = buildMarkdown({ url: "https://x.test/", title: "t", checkedAt: when, sections: [{ title: "S", rows: [{ title: "", url: "https://x.test/1" }] }] });
assert.ok(bare.includes("### S\n\n**[https://x.test/1](https://x.test/1)**\n\n_Saved by"), bare);   // no empty bullet, no empty quote

// ---- nothing found: still a valid, useful record ----
const empty = buildMarkdown({ url: "https://example.com/", title: "", checkedAt: when, summary: "No matches found", tally: "Hacker News 0", sections: [], notes: [] });
assert.ok(empty.startsWith("## Pre-check: https://example.com/"));
assert.ok(!empty.includes("### ") && !empty.includes("Notes"));
assert.ok(empty.includes("_Saved by pre-check page shares._"));

// ---- filenames ----
const f = (o) => markdownFilename({ checkedAt: when, ...o });
assert.equal(f({ title: "A Principled Approach as the Sands Shift - Creative Commons", url: "https://creativecommons.org/x" }), "pre-check-a-principled-approach-as-the-sands-shift-creative-2026-10-14.md");
assert.equal(f({ title: "", url: "https://www.getartcraft.com/" }), "pre-check-getartcraft-com-2026-10-14.md");
assert.equal(f({ title: "///???", url: "not a url" }), "pre-check-results-2026-10-14.md");
assert.equal(f({ title: "Türkiye: LGBTQ+ / 検閲?", url: "https://x.test/" }), "pre-check-türkiye-lgbtq-検閲-2026-10-14.md");
assert.ok(!/[\\/:*?"<>|]/.test(f({ title: 'a/b\\c:d*e?f"g<h>i|j', url: "https://x.test/" })));
console.log("markdown tests passed");
