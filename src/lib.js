// Shared logic: URL normalisation, matching, and querying Mastodon servers.

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|yclid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|ref_src|ref_url)$/i;

export function cleanUrl(input) {
  const u = new URL(input);
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  return u;
}

// Comparison key: ignores scheme, "www.", fragment, trailing slash, tracking params, param order.
export function linkKey(input) {
  try {
    const u = cleanUrl(input);
    const params = [...u.searchParams.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}${params ? "?" + params : ""}`;
  } catch {
    return null;
  }
}

// Turn what a person typed ("https://Mastodon.Social/@me") into a bare host ("mastodon.social"),
// or null if it isn't a plausible server name (e.g. an access token pasted in the wrong field).
export function normalizeHost(input) {
  const s = String(input ?? "").trim().replace(/^https?:\/\//i, "").replace(/[\/?#].*$/, "");
  if (!s || /[\s@]/.test(s)) return null;
  try {
    const u = new URL(`https://${s}`);
    if (!u.hostname.includes(".") || !/^[a-z0-9.-]+$/.test(u.hostname)) return null; // after punycode conversion
    return u.host;
  } catch {
    return null;
  }
}

// The URL as the tab shows it, and with tracking junk removed.
export function urlForms(input) {
  const original = new URL(input);
  original.hash = "";
  return [...new Set([original.href, cleanUrl(input).href])];
}

// Full-text queries for a URL. Two things learned from Mastodon's source and from testing by hand:
//  - A query that starts with http(s):// is treated as "resolve this URL" by the web UI and
//    skips text search entirely. (The API only does that when resolve=true, but a scheme-less
//    query is the form known to work, so we use it everywhere.)
//  - Without quotes, Mastodon matches posts containing ALL the words, so "host/path" finds the
//    URL wherever it appears. Colons break the query parser, so they become spaces.
// We try the host as written, without "www.", and with "www.", since posters differ.
export function urlQueries(input) {
  const out = new Set();
  // Cleaned form first: that's the one people are most likely to have posted, and we cap the list.
  for (const href of urlForms(input).reverse()) {
    const u = new URL(href);
    const rest = (u.pathname.replace(/\/+$/, "") + u.search).replace(/:/g, " ");
    const host = u.hostname.toLowerCase(); // hostname: no port, so no stray colon
    const bare = host.replace(/^www\./, "");
    out.add(host + rest);
    out.add(bare + rest);
    out.add("www." + bare + rest);
  }
  return [...out].slice(0, 4);
}

// A search string from the page title, or null if too short to be useful.
// Drops a trailing " | Site name" style suffix by keeping the longest segment.
export function titleQuery(title) {
  const longest = (title ?? "").split(/\s+[|–—-]\s+/).sort((a, b) => b.length - a.length)[0] ?? "";
  const words = longest
    .replace(/[":]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[+-]+/, ""))
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length >= 3 ? words.slice(0, 15).join(" ") : null;
}

// All hrefs in a status (post body links + preview card). DOMParser never runs scripts.
export function linksIn(status) {
  const s = status.reblog ?? status;
  const doc = new DOMParser().parseFromString(s.content ?? "", "text/html");
  const hrefs = [...doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
  if (s.card?.url) hrefs.push(s.card.url);
  return hrefs;
}

export function plainText(html) {
  return new DOMParser().parseFromString(html ?? "", "text/html").body.textContent.trim();
}

async function getJson(url, token, signal, extraHeaders = {}, fetchOpts = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { ...extraHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal, credentials: "omit", referrerPolicy: "no-referrer", ...fetchOpts });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("timed out");
    // Firefox reports CORS failures, blocked requests and DNS errors all as "NetworkError".
    const u = new URL(url);
    throw Object.assign(new Error(`could not fetch ${u.pathname} (${e.message})`), { network: true });
  }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

// ---------------------------------------------------------------------------
// Source: the page's own Fediverse account
// ---------------------------------------------------------------------------

// Runs INSIDE the page when you click the button (via scripting.executeScript), so it must be
// self-contained. Returns [{ acct: "name@host", via }] for Fediverse profiles the page points to.
export function scanPage() {
  const out = [];
  for (const m of document.querySelectorAll('meta[name="fediverse:creator"]')) {
    out.push({ acct: (m.content || "").trim().replace(/^@/, ""), via: "fediverse:creator" });
  }
  for (const a of document.querySelectorAll("a[href]")) {
    let u;
    try { u = new URL(a.href); } catch { continue; }
    if (u.protocol !== "https:") continue;
    const m = u.pathname.match(/^\/@([A-Za-z0-9_.-]+)\/?$/); // Mastodon-style profile path
    if (!m) continue;
    const rel = (a.getAttribute("rel") || "").split(/\s+/).includes("me");
    out.push({ acct: `${m[1]}@${u.hostname}`, via: rel ? "rel=me" : "profile link" });
  }
  return out;
}

// Sites that use /@name URLs but are not Mastodon. Heuristic, so a few strays will still get through.
const NOT_MASTODON = ["medium.com", "youtube.com", "tiktok.com", "threads.net", "threads.com", "instagram.com", "x.com",
  "twitter.com", "substack.com", "tumblr.com", "facebook.com", "linkedin.com", "github.com", "gitlab.com", "flickr.com",
  "vimeo.com", "pinterest.com", "reddit.com", "twitch.tv", "snapchat.com", "patreon.com", "dev.to", "hashnode.com"];
const isKnownNonMastodon = (host) => NOT_MASTODON.some((d) => host === d || host.endsWith("." + d));

// Strongest evidence first, de-duplicated, capped so a page full of profile links can't fan out requests.
export function pickCandidates(raw, max = 4) {
  const rank = { "fediverse:creator": 0, "rel=me": 1, "profile link": 2 };
  const seen = new Set();
  const out = [];
  for (const c of [...(raw ?? [])].sort((a, b) => (rank[a.via] ?? 9) - (rank[b.via] ?? 9))) {
    const m = /^([A-Za-z0-9_.-]+)@(.+)$/.exec(String(c.acct ?? "").replace(/^@/, ""));
    if (!m) continue;
    const host = normalizeHost(m[2]);
    if (!host || isKnownNonMastodon(host)) continue;
    const acct = `${m[1]}@${host}`;
    if (seen.has(acct.toLowerCase())) continue;
    seen.add(acct.toLowerCase());
    out.push({ acct, via: c.via });
    if (out.length >= max) break;
  }
  return out;
}

// Look through one account's recent public posts on ITS OWN server. No token is ever sent here:
// the server comes from the web page, so it is untrusted. Needs no search index or opt-in.
export async function checkPublisher({ acct, via }, url, signal) {
  const [name, host] = acct.split("@");
  const base = `https://${host}`;
  const key = linkKey(url);
  const label = `@${acct}`;
  const log = [];
  let account;
  try {
    account = await getJson(`${base}/api/v1/accounts/lookup?acct=${encodeURIComponent(name)}`, "", signal);
  } catch (e) {
    log.push(`account ${label} (${via}) → ${e.status ? "HTTP " + e.status : e.message}`);
    return { label, host, via, statuses: [], scanned: 0, log };
  }
  if (String(account.username).toLowerCase() !== name.toLowerCase()) {
    log.push(`account ${label} (${via}) → server returned a different account, skipped`);
    return { label, host, via, statuses: [], scanned: 0, log };
  }
  const found = [];
  let scanned = 0, oldest = null, maxId = null, error = null;
  for (let page = 0; page < 3; page++) { // up to 120 recent posts
    let list;
    try {
      list = await getJson(`${base}/api/v1/accounts/${account.id}/statuses?limit=40&exclude_reblogs=true${maxId ? `&max_id=${maxId}` : ""}`, "", signal);
    } catch (e) { error = e.status ? "HTTP " + e.status : e.message; break; }
    if (!list.length) break;
    scanned += list.length;
    oldest = list[list.length - 1].created_at;
    maxId = list[list.length - 1].id;
    for (const st of list) if (linksIn(st).some((h) => linkKey(h) === key)) found.push(st);
    if (found.length) break; // found it; no need to dig further back
  }
  log.push(`account ${label} (${via}) → scanned ${scanned} posts${oldest ? " back to " + oldest.slice(0, 10) : ""}, ${found.length} contain the link${error ? `; stopped: ${error}` : ""}`);
  return { label, host, via, statuses: found, scanned, log, ok: scanned > 0 };
}

// ---------------------------------------------------------------------------
// Source: Lemmy servers (link aggregators can search posts by their link)
// ---------------------------------------------------------------------------

// Lemmy compares the whole URL, so try the likely spellings.
export function lemmyVariants(input) {
  const out = new Set();
  for (const href of urlForms(input).reverse()) { // cleaned form first
    out.add(href);
    if (href.endsWith("/")) out.add(href.slice(0, -1));
    else if (!href.includes("?")) out.add(href + "/");
  }
  return [...out].slice(0, 4);
}

// Uses the public v3 search API with type_=Url. No login. Lemmy 1.0 reworked its API, so a failure
// here shows up in the Details log as an HTTP status rather than failing silently.
export async function checkLemmy(host, url, signal) {
  const base = `https://${host}`;
  const key = linkKey(url);
  const found = new Map();
  const log = [];
  await Promise.all(lemmyVariants(url).map(async (v) => {
    const label = `lemmy ${host} search ${v}`;
    const slot = log.push(`${label} → …`) - 1;
    try {
      const r = await getJson(`${base}/api/v3/search?q=${encodeURIComponent(v)}&type_=Url&sort=New&limit=20`, "", signal);
      const posts = r.posts ?? [];
      let m = 0;
      for (const pv of posts) {
        if (pv.post?.url && linkKey(pv.post.url) === key) { found.set(pv.post.ap_id ?? String(pv.post.id), pv); m++; }
      }
      log[slot] = `${label} → ${posts.length} returned, ${m} have this link`;
    } catch (e) {
      log[slot] = `${label} → ${e.status ? "HTTP " + e.status : e.message}`;
    }
  }));
  const posts = [...found.values()]
    .map((pv) => ({
      title: pv.post.name, url: `${base}/post/${pv.post.id}`, community: pv.community?.name, author: pv.creator?.name,
      created_at: pv.post.published, score: pv.counts?.score ?? 0, comments: pv.counts?.comments ?? 0,
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { host, items: posts, log, ok: log.some((l) => /returned/.test(l)) };
}

// ---------------------------------------------------------------------------
// Sources: Hacker News, Lobsters, Reddit. Each returns { items, log, ok } where items are
// { title, url, community?, author?, created_at?, score, comments } and url is the discussion page.
// ---------------------------------------------------------------------------

// Hacker News via Algolia's public search, restricted to the story URL field. Results are re-checked
// with linkKey because Algolia matches loosely (typos, prefixes).
export async function checkHackerNews(url, signal) {
  const key = linkKey(url);
  const found = new Map();
  const log = [];
  await Promise.all(urlQueries(url).slice(0, 3).map(async (q) => {
    const label = `hacker news search ${q}`;
    const slot = log.push(`${label} → …`) - 1;
    try {
      const r = await getJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&restrictSearchableAttributes=url&tags=story&hitsPerPage=20`, "", signal);
      const hits = r.hits ?? [];
      let m = 0;
      for (const h of hits) if (h.url && linkKey(h.url) === key) { found.set(h.objectID, h); m++; }
      log[slot] = `${label} → ${hits.length} returned, ${m} have this link`;
    } catch (e) { log[slot] = `${label} → ${e.status ? "HTTP " + e.status : e.message}`; }
  }));
  const items = [...found.values()].map((h) => ({
    title: h.title, url: `https://news.ycombinator.com/item?id=${h.objectID}`, author: h.author,
    created_at: h.created_at, score: h.points ?? 0, comments: h.num_comments ?? 0,
  })).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { items, log, ok: log.some((l) => /returned/.test(l)) };
}

// Lobsters: public JSON endpoint used by its own submit-form duplicate check. The server normalises
// URLs itself, so its answer is trusted as-is. No login. It rate-limits (HTTP 429), and we only ask on click.
export async function checkLobsters(url, signal) {
  const found = new Map();
  const log = [];
  await Promise.all(urlForms(url).reverse().map(async (u) => {
    const label = `lobsters ${u}`;
    const slot = log.push(`${label} → …`) - 1;
    try {
      const list = await getJson(`https://lobste.rs/stories/url/all.json?url=${encodeURIComponent(u)}`, "", signal);
      const arr = Array.isArray(list) ? list : [];
      for (const st of arr) found.set(st.short_id, st);
      log[slot] = `${label} → ${arr.length} returned, ${arr.length} have this link`;
    } catch (e) { log[slot] = `${label} → ${e.status ? "HTTP " + e.status + (e.status === 429 ? " (rate-limited)" : "") : e.message}`; }
  }));
  const items = [...found.values()].map((st) => ({
    title: st.title, url: st.comments_url ?? st.short_id_url ?? `https://lobste.rs/s/${st.short_id}`,
    author: typeof st.submitter_user === "string" ? st.submitter_user : st.submitter_user?.username,
    community: (st.tags ?? []).join(", "), created_at: st.created_at, score: st.score ?? 0, comments: st.comment_count ?? 0,
  })).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { items, log, ok: log.some((l) => /returned/.test(l)) };
}

// Reddit's /api/info.json?url= matches the URL string exactly as it was submitted, so one spelling
// is not enough: https vs http, www vs bare host, trailing slash. This approach (probe a few common
// spellings, then match strictly) was learned by reading the MIT-licensed ReadIt extension for Firefox.
export function redditVariants(input) {
  const base = cleanUrl(input);
  const out = new Set();
  const schemes = base.protocol === "http:" ? ["https:", "http:"] : [base.protocol];
  for (const protocol of schemes) {
    const u = new URL(base.href);
    u.protocol = protocol;
    // As written first, then the www toggle, each with and without a trailing slash (root URLs have only one form).
    const hosts = [u.hostname, u.hostname.startsWith("www.") ? u.hostname.slice(4) : "www." + u.hostname];
    for (const hostname of hosts) {
      const v = new URL(u.href);
      v.hostname = hostname;
      out.add(v.href);
      if (v.pathname !== "/") {
        const t = new URL(v.href);
        t.pathname = v.pathname.endsWith("/") ? v.pathname.replace(/\/+$/, "") : v.pathname + "/";
        out.add(t.href);
      }
    }
  }
  return [...out].slice(0, 6);
}

// Reddit: requests carry the user's reddit.com cookies (credentials: "include"). Tested by the user in
// Firefox, including in a fresh container: with cookies the lookup succeeds, without them Reddit answers
// HTTP 403, so there is deliberately no cookie-less attempt. Requests go one after another (Reddit throttles
// bursts), and every response status is logged. A 403 gets the same answer for every spelling, and a 429
// means "slow down", so either one stops the rest. A hit must match strictly, using the post's real
// destination URL, and removed or deleted posts are labelled instead of hidden.
export async function checkReddit(url, signal) {
  const key = linkKey(url);
  const found = new Map();
  const log = [];
  let forbidden = false;
  for (const v of redditVariants(url)) {
    const label = `reddit info ${v}`;
    try {
      const r = await getJson(`https://www.reddit.com/api/info.json?url=${encodeURIComponent(v)}&limit=100`, "", signal,
        { Accept: "application/json" }, { credentials: "include" });
      const kids = r?.data?.children ?? [];
      let m = 0;
      for (const k of kids) {
        const d = k.data;
        const dest = d?.url_overridden_by_dest || d?.url;
        if (dest && linkKey(dest) === key) { found.set(d.name ?? d.permalink, d); m++; }
      }
      log.push(`${label} → ${kids.length} returned, ${m} have this link`);
    } catch (e) {
      log.push(`${label} → ${e.status ? "HTTP " + e.status : e.message}`);
      if (e.status === 403) { forbidden = true; log.push("  stopped: every spelling gets the same answer"); break; }
      if (e.status === 429) { log.push("  stopped: Reddit is rate-limiting, try again in a minute"); break; }
    }
  }
  const items = [...found.values()].map((d) => {
    const removed = Boolean(d.removed_by_category || d.banned_by || d.removed_by || d.author === "[deleted]" || d.author === null);
    return {
      title: d.title, url: `https://www.reddit.com${d.permalink}`,
      community: `${d.subreddit_name_prefixed ?? `r/${d.subreddit}`}${removed ? " (removed)" : ""}`,
      author: d.author, created_at: new Date((d.created_utc ?? 0) * 1000).toISOString(), score: d.score ?? 0, comments: d.num_comments ?? 0,
    };
  }).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { items, log, ok: log.some((l) => /returned/.test(l)), forbidden };
}

// Query one server. Returns { host, statuses, titleStatuses, notes, searched, log }.
//  statuses      – posts that really contain this link
//  titleStatuses – posts matching the page title but not containing the link
//  log           – one line per request (what was asked, what came back); never contains the token
// Sources:
//  1. /api/v1/timelines/link – public, but ONLY for currently *trending* links.
//  2. /api/v2/search         – needs a token (read:search) AND full-text search on the server.
export async function checkInstance({ host, token }, { url, title }, signal) {
  const base = `https://${host}`;
  const key = linkKey(url);
  const found = new Map();
  const titleHits = new Map();
  const notes = [];
  const log = [];

  const hasLink = (s) => linksIn(s).some((h) => linkKey(h) === key);
  // Precision filter: only keep posts that really contain this link. Returns how many did.
  const keep = (list) => {
    let n = 0;
    for (const st of list ?? []) {
      const s = st.reblog ?? st;
      if (hasLink(s)) { found.set(s.uri ?? s.url, s); n++; }
    }
    return n;
  };
  const search = (q, limit) =>
    `${base}/api/v2/search?q=${encodeURIComponent(q)}&type=statuses&resolve=false&limit=${limit}`;

  // Run one request; record a log line in a fixed slot so the order doesn't depend on which finishes first.
  const probe = (label, requestUrl, onData, onError) => {
    const slot = log.push(`${label} → …`) - 1;
    return getJson(requestUrl, token, signal).then(
      (data) => { const [returned, matched] = onData(data); log[slot] = `${label} → ${returned} returned, ${matched} contain the link`; },
      (e) => { log[slot] = `${label} → ${e.status ? "HTTP " + e.status : e.message}`; onError?.(e); }
    );
  };

  // Permission check gives a much clearer hint than a bare "NetworkError".
  try {
    if (!(await browser.permissions.contains({ origins: [`${base}/*`] }))) {
      notes.push("no permission for this server yet: open Settings and press Save");
    }
  } catch { /* ignore */ }

  const jobs = [];

  for (const u of urlForms(url)) {
    jobs.push(probe(
      `link timeline for ${u}`,
      `${base}/api/v1/timelines/link?url=${encodeURIComponent(u)}&limit=40`,
      (list) => [list.length, keep(list)],
      (e) => {
        if (e.status === 401) notes.push("link timeline needs login on this server");
        else if (e.status !== 404) notes.push(`link timeline: ${e.message}`); // 404 = not trending, normal
      }
    ));
  }

  if (token) {
    for (const q of urlQueries(url)) {
      jobs.push(probe(
        `search ${q}`,
        search(q, 40),
        (r) => [(r.statuses ?? []).length, keep(r.statuses)],
        (e) => notes.push(e.status === 401 ? "search: token rejected (needs read:search)" : `search: ${e.message}`)
      ));
    }
    const tq = titleQuery(title);
    if (tq) {
      // Quoted = exact phrase. Unquoted matches posts containing all the words anywhere, which is far too loose.
      jobs.push(probe(
        `title search "${tq}"`,
        search(`"${tq}"`, 10),
        (r) => {
          let m = 0;
          for (const st of r.statuses ?? []) { const s = st.reblog ?? st; titleHits.set(s.uri ?? s.url, s); if (hasLink(s)) m++; }
          return [(r.statuses ?? []).length, m];
        }
      ));
    }
  } else {
    notes.push("no access token, so post search was skipped");
  }

  await Promise.all(jobs);
  // A title hit that also contains the link is a link match; the rest only share the title.
  for (const [k, s] of titleHits) if (hasLink(s)) { found.set(k, s); titleHits.delete(k); }
  const byNewest = (a, b) => (a.created_at < b.created_at ? 1 : -1);
  const statuses = [...found.values()].sort(byNewest);
  const titleStatuses = [...titleHits.entries()].filter(([k]) => !found.has(k)).map(([, v]) => v).sort(byNewest);
  return { host, statuses, titleStatuses, notes: [...new Set(notes)], searched: Boolean(token), log };
}
