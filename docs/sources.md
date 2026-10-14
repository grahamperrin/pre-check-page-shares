# How each place is checked

What the extension asks each site, why it asks it that way, and how far each claim has been verified. "Verified" means the author saw it work in Firefox; "read from source" means it was taken from the other project's published code and has not been independently exercised.

Every source goes through the same final step: results are compared with the page's address using `linkKey()` in `src/lib.js`, which ignores the scheme, `www.`, a trailing slash, the fragment, tracking parameters (`utm_*`, `fbclid`, and so on) and parameter order. Lobsters is the exception: its server does its own URL normalisation, so its answer is used as returned.

## Hacker News

`GET https://hn.algolia.com/api/v1/search?query=<host/path>&restrictSearchableAttributes=url&tags=story&hitsPerPage=20`

Algolia's public Hacker News search, restricted to the story URL field. The query is the address without its scheme, tried with the host as written, without `www.` and with `www.`, up to three requests. Algolia matches loosely, so hits are re-checked with `linkKey()`. Verified.

## Lemmy

`GET https://<server>/api/v3/search?q=<url>&type_=Url&sort=New&limit=20`

Public, no login. Lemmy compares the whole URL, so a few spellings are tried (cleaned form first, with and without a trailing slash). A server only knows the communities its users follow, so a few large servers are better than one. Verified on `lemmy.world`.

Lemmy 1.0 reworked its API. If a server has dropped the v3 search, the Details section in the popup shows an HTTP status for each request instead of failing silently.

## Lobsters

`GET https://lobste.rs/stories/url/all.json?url=<url>`

Read from the Lobsters source: `StoryUrlsController`, which also serves the duplicate check on the submit form. It needs no login, and the server normalises the URL itself. Fields used: `short_id`, `title`, `comments_url` (or `short_id_url`), `submitter_user`, `score`, `comment_count`, `created_at`, `tags`. Verified.

Lobsters does not send CORS headers (this is what stopped [Newsit's issue #12](https://github.com/benwinding/newsit/issues/12)). An extension that holds host permission for `https://lobste.rs/*` can make the request from its own pages without CORS getting in the way. The permission is optional and requested when the user presses Save in the settings page. Lobsters is a small volunteer-run site that rate-limits, so the extension only asks when the user clicks, and says "rate-limited" on HTTP 429.

## Reddit

`GET https://www.reddit.com/api/info.json?url=<spelling>&limit=100`, sent with `credentials: "include"`.

Reddit matches the URL string exactly as it was submitted, so several spellings are tried one after another: with and without `www.`, with and without a trailing slash (root URLs have one form), and `https` before `http`. A hit must match strictly on the post's real destination URL (`url_overridden_by_dest`, falling back to `url`), and removed posts are labelled "(removed)" rather than hidden. The approach of probing spellings was learned from the MIT-licensed ReadIt extension; no code was copied.

**Cookies are required.** Observed by the author in Firefox: without `reddit.com` cookies the request gets HTTP 403, and with them it succeeds. This was tested in the default container and in fresh temporary containers. A 403 stops the run (every spelling would get the same answer), as does a 429. Reddit is off by default for this reason.

## Mastodon

Three routes, because no single one is complete.

**Search**, `GET /api/v2/search?q=<host/path>&type=statuses&resolve=false`, needs an access token (`read:search`). Read from the Mastodon source:

- A query that starts with `http://` or `https://` is treated by the web UI as "resolve this URL" and skips text search, so the extension sends the address without its scheme. Unquoted, Mastodon matches posts containing all the words, so `host/path` finds the URL wherever it appears. Colons are replaced with spaces because the query parser splits on them.
- The page title is searched as an exact phrase (quoted). Unquoted, it matched unrelated posts. Title hits are shown separately unless they also contain the link.
- Search can only see public posts from accounts that opted in to search indexing (off by default, and only for posts made after opting in), plus posts the searching account wrote, was mentioned in, favourited, boosted or bookmarked. A miss is not proof the link is new.

**Link timeline**, `GET /api/v1/timelines/link?url=`, is public but only works for links currently trending on that server, so it rarely finds anything.

**The page's own account** is the route that doesn't depend on the search index. When the button is clicked, the page is read for `fediverse:creator` meta tags, `rel="me"` links and profile links of the form `https://host/@name`. Links to well-known non-Mastodon sites that use the same URL shape (Medium, YouTube and similar) are skipped, and at most four accounts are considered. For each, the extension asks the account's own server (`/api/v1/accounts/lookup`, then `/api/v1/accounts/<id>/statuses`, up to three pages of 40) and looks for the link. These servers come from a web page, so they never receive the user's token. This found a post that search could not. Verified.

## Containers and cookies

- The toolbar popup runs outside any container.
- A tab opened next to another tab inherits that tab's container, unless a container is chosen (read from Firefox's tab code: "Related tab inherits current tab's user context unless a different usercontextid is specified"). The results tab is opened next to the checked page, so by default it inherits that page's container.
- Requests made from the results tab use that container's cookies. A fresh temporary container has no `reddit.com` cookies, so Reddit answers 403 there.
- The settings page can pick a container for the results tab, or "Default (no container)". That needs two permissions: `contextualIdentities` (to list containers), and the optional `cookies` permission, which is documented as required for opening a tab in a chosen container. Whether Firefox actually enforces the `cookies` permission here was not confirmed from source, so it is requested to be safe, and only when the option is switched on. Verified: the results opened in the chosen container.

## Not done

- Other aggregators with similar APIs (PieFed, Mbin).
- Caching results, or checking on a schedule.
- Browsers other than Firefox.
