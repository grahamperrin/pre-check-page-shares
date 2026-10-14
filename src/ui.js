import {
  checkHackerNews, checkInstance, checkLemmy, checkLobsters, checkPublisher, checkReddit,
  normalizeHost, pickCandidates, plainText, urlQueries,
} from "./lib.js";
import { buildMarkdown, downloadMarkdown, markdownFilename } from "./markdown.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // textContent only: remote content is never injected as HTML
  return n;
};
const DEFAULT_SOURCES = { hn: true, lobsters: true, reddit: false, publisher: true };
// These two don't send CORS headers we can rely on, so they need host permission (granted when you press Save).
const NEEDS_PERMISSION = [["lobsters", "Lobsters", "https://lobste.rs/*"], ["reddit", "Reddit", "https://www.reddit.com/*"]];

function header(label, href, linkText) {
  const head = el("div", "host");
  head.append(el("span", null, label));
  if (href) {
    const a = el("a", null, linkText);
    a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
    head.append(a);
  }
  return head;
}

function postLink(href) {
  const a = el("a", "post");
  a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
  return a;
}
const day = (iso) => (iso ? new Date(iso).toLocaleDateString() : "");

// The same facts the renderers show, as plain rows for the Markdown file.
const rowOfStatus = (s) => ({
  title: s.account.display_name || s.account.username, url: s.url,
  meta: `@${s.account.acct} · ${day(s.created_at)}`, excerpt: plainText(s.content),
  stats: `↻ ${s.reblogs_count}  ★ ${s.favourites_count}  ↩ ${s.replies_count}`,
});
const rowOfItem = (it) => ({
  title: it.title || it.url, url: it.url,
  meta: [it.community, it.author && `by ${it.author}`, day(it.created_at)].filter(Boolean).join(" · "),
  stats: `▲ ${it.score}   💬 ${it.comments}`,
});

function renderStatus(s) { // a Mastodon post
  const a = postLink(s.url);
  const who = el("div");
  who.append(el("span", "who", s.account.display_name || s.account.username), el("span", "meta", ` @${s.account.acct} · ${day(s.created_at)}`));
  a.append(who, el("div", "text", plainText(s.content)), el("div", "meta", `↻ ${s.reblogs_count}  ★ ${s.favourites_count}  ↩ ${s.replies_count}`));
  return a;
}

function renderItem(it) { // Hacker News / Lemmy / Lobsters / Reddit
  const a = postLink(it.url);
  a.append(
    el("div", "who", it.title || it.url),
    el("div", "meta", [it.community, it.author && `by ${it.author}`, day(it.created_at)].filter(Boolean).join(" · ")),
    el("div", "meta", `▲ ${it.score}   💬 ${it.comments}`)
  );
  return a;
}

// Shared by the toolbar popup and the results page. Both use the same element ids.
//   url, title: the page being checked
//   scan():     async, returns raw Fediverse-profile candidates from that page (or [])
async function main({ url, title, scan }) {
  if (!url || !/^https?:/.test(url)) { $("summary").textContent = "Open a web page first."; return; }
  $("page").textContent = url;
  $("page").title = url;

  const store = await browser.storage.local.get(["instances", "lemmyHosts", "sources"]);
  const sources = { ...DEFAULT_SOURCES, ...(store.sources ?? {}) };
  const stored = store.instances ?? [];
  const instances = stored.filter((i) => normalizeHost(i.host));
  const lemmyHosts = (store.lemmyHosts ?? []).filter((h) => normalizeHost(h));
  if (stored.length > instances.length) {
    // Don't print the entry itself: a mistyped server field may actually contain a token.
    $("notes").append(el("li", null, `${stored.length - instances.length} Mastodon entry in Settings has no valid server name and was skipped.`));
  }
  for (const [k, name, origin] of NEEDS_PERMISSION) {
    if (sources[k] && !(await browser.permissions.contains({ origins: [origin] }).catch(() => false))) {
      $("notes").append(el("li", null, `${name}: no permission yet. Open Settings and press Save.`));
    }
  }

  // Which Fediverse accounts does this page point to? The page is read only now, on your click.
  let candidates = [];
  if (sources.publisher) {
    try { candidates = pickCandidates((await scan()) ?? []); } catch (e) { /* restricted pages (about:, addons.mozilla.org) can't be scanned */ }
  }

  // One slow source must not hang the popup.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  const sig = ctl.signal;
  const generic = (name, p) => p.catch((e) => ({ items: [], log: [`${name} → ${e.message}`], ok: false }));
  const [hn, lemmy, lobsters, mastodon, publishers, reddit] = await Promise.all([
    sources.hn ? generic("hacker news", checkHackerNews(url, sig)) : null,
    Promise.all(lemmyHosts.map((h) => generic(`lemmy ${h}`, checkLemmy(h, url, sig)).then((r) => ({ host: h, ...r })))),
    sources.lobsters ? generic("lobsters", checkLobsters(url, sig)) : null,
    Promise.all(instances.map((i) =>
      checkInstance(i, { url, title }, sig).catch((e) => ({ host: i.host, statuses: [], titleStatuses: [], notes: [e.message], searched: Boolean(i.token), log: [] })))),
    Promise.all(candidates.map((c) =>
      checkPublisher(c, url, sig).catch((e) => ({ label: `@${c.acct}`, via: c.via, statuses: [], scanned: 0, ok: false, log: [`account @${c.acct} → ${e.message}`] })))),
    sources.reddit ? generic("reddit", checkReddit(url, sig)) : null,
  ]);
  clearTimeout(timer);

  // ---- render, in alphabetical order of source ----
  const seen = new Set(); // the same post reached by several routes
  const fresh = (list, key) => list.filter((x) => !seen.has(key(x)) && seen.add(key(x)));
  const out = $("results");
  const counts = { hn: 0, lemmy: 0, lobsters: 0, mastodon: 0, reddit: 0 };
  let titleHits = 0;
  const sections = []; // the same results as plain rows, for "Save"
  const addItems = (k, label, r, href, linkText) => {
    const list = fresh(r.items, (x) => x.url);
    if (!list.length) return;
    out.append(header(label, href, linkText));
    for (const it of list) { counts[k]++; out.append(renderItem(it)); }
    sections.push({ title: label, rows: list.map(rowOfItem) });
  };

  if (hn) addItems("hn", "Hacker News", hn);
  for (const r of lemmy) addItems("lemmy", `Lemmy · ${r.host}`, r, `https://${r.host}/search?q=${encodeURIComponent(url)}&type=Url`, "search on web ↗");
  if (lobsters) addItems("lobsters", "Lobsters", lobsters);

  for (const r of mastodon) {
    out.append(header(`Mastodon · ${r.host}`, `https://${r.host}/search?q=${encodeURIComponent(urlQueries(url)[0])}`, "search on web ↗"));
    const linked = fresh(r.statuses, (x) => x.url);
    for (const s of linked) { counts.mastodon++; out.append(renderStatus(s)); }
    if (linked.length) sections.push({ title: `Mastodon · ${r.host}`, rows: linked.map(rowOfStatus) });
    const similar = fresh(r.titleStatuses, (x) => x.url);
    if (similar.length) {
      out.append(el("div", "sub", "Same title, but no link to this page"));
      for (const s of similar) { titleHits++; out.append(renderStatus(s)); }
      sections.push({ title: `Mastodon · ${r.host}: same title, but no link to this page`, rows: similar.map(rowOfStatus) });
    }
    for (const n of r.notes) $("notes").append(el("li", null, `${r.host}: ${n}`));
  }
  for (const p of publishers) {
    const list = fresh(p.statuses, (x) => x.url);
    if (!list.length) continue;
    out.append(header(`Mastodon · page's own account ${p.label}`, null));
    for (const s of list) { counts.mastodon++; out.append(renderStatus(s)); }
    sections.push({ title: `Mastodon · page's own account ${p.label}`, rows: list.map(rowOfStatus) });
  }
  if (reddit) addItems("reddit", "Reddit", reddit);

  // ---- details log (never contains tokens) ----
  const lines = [];
  const add = (title, log) => { if (log?.length) lines.push(title, ...log.map((l) => "  " + l)); };
  if (hn) add("Hacker News", hn.log);
  lemmy.forEach((r) => add(`Lemmy ${r.host}`, r.log));
  if (lobsters) add("Lobsters", lobsters.log);
  mastodon.forEach((r) => add(`Mastodon ${r.host}`, r.log));
  publishers.forEach((p) => add(`Mastodon page account (${p.via})`, p.log));
  if (reddit) add("Reddit", reddit.log);
  if (lines.length) {
    $("log").textContent = lines.join("\n");
    for (const id of ["details", "details-toggle"]) { const e = $(id); if (e) e.hidden = false; } // whichever this page has
  }

  // ---- one-line tally: what was checked, what each found ----
  const mastodonSearched = mastodon.some((r) => r.searched && r.log.some((l) => /returned/.test(l)));
  const mastodonOk = mastodonSearched || publishers.some((p) => p.ok);
  const mastodonAsked = instances.length > 0 || publishers.length > 0;
  const tokenNeeded = instances.length > 0 && !mastodon.some((r) => r.searched);
  const tally = [];
  const t = (name, r) => tally.push(r.ok ? `${name} ${counts[nameKey[name]]}` : `${name} ✕`);
  const nameKey = { "Hacker News": "hn", Lemmy: "lemmy", Lobsters: "lobsters", Mastodon: "mastodon", Reddit: "reddit" };
  if (hn) t("Hacker News", hn);
  if (lemmy.length) t("Lemmy", { ok: lemmy.some((r) => r.ok) });
  if (lobsters) t("Lobsters", lobsters);
  if (mastodonAsked) tally.push(mastodonOk ? `Mastodon ${counts.mastodon}` : tokenNeeded ? "Mastodon: token needed" : "Mastodon ✕");
  if (reddit) t("Reddit", reddit);
  $("tally").textContent = tally.join(" · ");
  if (tally.some((x) => x.includes("✕"))) $("notes").append(el("li", null, "✕ means every request to that source failed. See Details."));
  if (reddit?.forbidden) {
    const inTab = location.pathname.endsWith("/results.html");
    $("notes").append(el("li", null, inTab
      ? "Reddit answered HTTP 403 (forbidden). In this tab the lookup uses the reddit.com cookies of the container the tab is open in. Settings can open the results tab in a container you choose."
      : "Reddit answered HTTP 403 (forbidden). This lookup uses your Firefox session's cookies for reddit.com."));
  }

  // ---- headline ----
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const anyOk = [hn, lobsters, reddit].some((r) => r?.ok) || lemmy.some((r) => r.ok) || mastodonOk;
  const s = $("summary");
  if (total) { s.textContent = `Found ${total} post${total === 1 ? "" : "s"} with this link`; s.classList.add("hit"); }
  else if (titleHits) { s.textContent = `Link not found, but ${titleHits} Mastodon post${titleHits === 1 ? "" : "s"} share the title`; s.classList.add("hit"); }
  else if (!anyOk && tokenNeeded) s.textContent = "Can't search Mastodon without a token";
  else if (!anyOk) s.textContent = "Couldn't reach any source";
  else s.textContent = "No matches found";
  if (!total && mastodonSearched) $("notes").append(el("li", null, "Mastodon only searches posts from accounts that opted in to search (plus posts you've interacted with), so a miss isn't proof the link is new."));
  if (candidates.length && !publishers.some((p) => p.statuses.length)) {
    $("notes").append(el("li", null, `Also checked the page's own account${candidates.length > 1 ? "s" : ""}: ${candidates.map((c) => "@" + c.acct).join(", ")}`));
  }
  if (!instances.length && !lemmyHosts.length && !sources.hn && !sources.lobsters && !sources.reddit && !sources.publisher) {
    s.textContent = "Nothing is switched on."; $("notes").append(el("li", null, "Open Settings to choose where to look."));
  }

  // ---- Save as Markdown (nothing to save if nothing was checked) ----
  const save = $("save");
  if (save && tally.length) {
    const result = {
      url, title, checkedAt: new Date(), summary: s.textContent, tally: tally.join(" · "), sections,
      notes: [...document.querySelectorAll("#notes li")].map((li) => li.textContent),
      generator: `pre-check page shares ${browser.runtime?.getManifest?.().version ?? ""}`.trim(),
    };
    save.hidden = false;
    save.onclick = () => downloadMarkdown(markdownFilename(result), buildMarkdown(result));
  }
}

export async function run(opts) {
  try { await main(opts); } catch (e) { $("summary").textContent = "Error"; $("notes").append(el("li", null, e.message)); }
}
