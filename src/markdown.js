// "Save" support: builds a Markdown file from the results on screen and offers it as a download.
// buildMarkdown / markdownFilename are pure (no DOM), so they are easy to test.

const pad = (n) => String(n).padStart(2, "0");
export const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localStamp = (d) => `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Titles, usernames and post text come from other people's pages, so characters that Markdown treats as
// formatting are escaped and line breaks are flattened. (URLs go through href() instead.)
const esc = (t) => String(t ?? "").replace(/\s+/g, " ").trim().replace(/([\\`*_[\]<>|])/g, "\\$1");
const href = (u) => String(u ?? "").trim().replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/</g, "%3C").replace(/>/g, "%3E");

// result: { url, title, checkedAt: Date, summary, tally, sections: [{ title, rows: [{ title, url, meta, excerpt, stats }] }], notes: [string], generator? }
export function buildMarkdown(result) {
  const { url, title, checkedAt, summary, tally, sections = [], notes = [], generator } = result;
  const out = [];
  out.push(`# Pre-check: ${esc(title || url)}`, "");
  out.push(`- Page: <${href(url)}>`);
  out.push(`- Checked: ${checkedAt instanceof Date ? localStamp(checkedAt) : esc(checkedAt)}`);
  if (summary) out.push(`- Result: ${esc(summary)}`);
  if (tally) out.push(`- Places: ${esc(tally)}`);
  for (const section of sections) {
    out.push("", `## ${esc(section.title)}`, "");
    for (const r of section.rows) {
      out.push(`- [${esc(r.title || r.url)}](${href(r.url)})${r.meta ? ` — ${esc(r.meta)}` : ""}`);
      if (r.stats) out.push(`  ${esc(r.stats)}`);
      if (r.excerpt) out.push(`  > ${esc(r.excerpt.length > 280 ? r.excerpt.slice(0, 280).trimEnd() + "…" : r.excerpt)}`);
    }
  }
  if (notes.length) {
    out.push("", "## Notes", "");
    for (const n of notes) out.push(`- ${esc(n)}`);
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
