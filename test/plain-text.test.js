import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
globalThis.DOMParser = new JSDOM().window.DOMParser;
const { plainText } = await import("../src/lib.js");

// paragraphs and line breaks keep their separation (they used to be glued: "support.https://…")
assert.equal(plainText("<p>one.</p><p>two.</p>").replace(/\s+/g, " "), "one. two.");
assert.equal(plainText("a<br>b").replace(/\s+/g, " "), "a b");
assert.ok(!plainText("<p>support.</p><p>https://x.test/</p>").includes("support.https"));

// Mastodon splits a long address into hidden and visible spans; the text is still the whole address
const masto = '<p>See <a href="https://x.test/a/b"><span class="invisible">https://</span><span class="ellipsis">x.test/a</span><span class="invisible">/b</span></a></p>';
assert.equal(plainText(masto).replace(/\s+/g, " "), "See https://x.test/a/b");

// entities are decoded, surrounding whitespace is trimmed, empty input is safe
assert.equal(plainText("<p>Fish &amp; chips</p>"), "Fish & chips");
assert.equal(plainText(""), "");
assert.equal(plainText(undefined), "");
console.log("plain text tests passed");
