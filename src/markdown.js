// "Save" support: builds a Markdown file from the results on screen and offers it as a download.
// buildMarkdown / markdownFilename are pure (no DOM), so they are easy to test.
//
// The output is written to survive being pasted into Reddit, old and new:
//  - Fediverse handles are written as explicit links, because Reddit reads a bare @user@host as an email address.
//  - Nothing is indented. Indented quotes under bullet points don't render reliably in both versions of Reddit,
//    so each post is: a bold linked title, one bullet of facts, then a flush-left quote.
//  - Every block is separated by a blank line.
// (New Reddit may show "##" headings as level 1. That is accepted.)

const pad = (n) => String(n).padStart(2, "0");
export const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localStamp = (d) => `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const flat = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
const ESC = (t) => t.replace(/([\\`*_[\]<>|])/g, "\\$1");        // characters Markdown treats as formatting
const esc = (t) => ESC(flat(t));
const href = (u) => String(u ?? "").trim().replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/</g, "%3C").replace(/>/g, "%3E");

// Free text from other people's pages (post excerpts, titles, our own notes). Escaped, except that
//  - a full Fediverse handle (@user@host) becomes [@user@host](https://host/@user), and
//  - a web address is left exactly as it is, since escaping its underscores would break it.
const HANDLE_OR_URL = /(https?:\/\/[^\s<>]*[^\s<>.,;:!?)"'\]]|@[A-Za-z0-9_][A-Za-z0-9_.-]*@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;
function text(t) {
  const s = flat(t);
  let out = "";
  let last = 0;
  for (const m of s.matchAll(HANDLE_OR_URL)) {
    out += ESC(s.slice(last, m.index));
    if (m[0].startsWith("@")) {
      const [, user, host] = /^@([^@]+)@(.+)$/.exec(m[0]);
      out += `[${ESC(m[0])}](${href(`https://${host}/@${user}`)})`;
    } else {
      out += m[0];
    }
    last = m.index + m[0].length;
  }
  return out + ESC(s.slice(last));
}

// Cut at a word boundary, so a web address is never chopped in half.
function truncate(s, max = 500) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

// result: { url, title, checkedAt: Date, summary, tally, notes: [string], generator?,
//           sections: [{ title, rows: [{ title, url, handle?: { text, url }, meta?, stats?, excerpt? }] }] }
export function buildMarkdown(result) {
  const { url, title, checkedAt, summary, tally, sections = [], notes = [], generator } = result;
  const out = [];
  out.push(`# Pre-check: ${esc(title || url)}`, "");
  out.push(`- Page: <${href(url)}>`);
  out.push(`- Checked: ${checkedAt instanceof Date ? localStamp(checkedAt) : esc(checkedAt)}`);
  if (summary) out.push(`- Result: ${esc(summary)}`);
  if (tally) out.push(`- Places: ${esc(tally)}`);

  for (const section of sections) {
    out.push("", `## ${text(section.title)}`);
    for (const r of section.rows) {
      out.push("", `**[${esc(r.title || r.url)}](${href(r.url)})**`);
      const facts = [
        r.handle && `[${ESC(flat(r.handle.text))}](${href(r.handle.url)})`,
        r.meta && text(r.meta),
        r.stats && esc(r.stats),
      ].filter(Boolean);
      if (facts.length) out.push("", `- ${facts.join(" · ")}`);
      if (r.excerpt) out.push("", `> ${text(truncate(flat(r.excerpt)))}`);
    }
  }
  if (notes.length) {
    out.push("", "## Notes", "");
    for (const n of notes) out.push(`- ${text(n)}`);
  }
  out.push("", `_Saved by ${generator || "pre-check page shares"}._`, "");
  return out.join("\n");
}

// pre-check-<title or host>-<YYYY-MM-DD>.md, safe on every common file system.
export function markdownFilename({ title, url, checkedAt }) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* not a URL */ }
  const slug = String(title || host || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/, "") || "results";
  return `pre-check-${slug}-${localDay(checkedAt instanceof Date ? checkedAt : new Date())}.md`;
}

// A data: URL (not a blob: URL) so the download can't be cut off if the popup closes first.
// No "downloads" permission is needed; the file goes wherever Firefox saves downloads (or asks, per your setting).
export function downloadMarkdown(filename, text) {
  const a = document.createElement("a");
  a.href = "data:text/markdown;charset=utf-8," + encodeURIComponent(text);
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
}
