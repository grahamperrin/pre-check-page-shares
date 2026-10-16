# pre-check page shares

A Firefox extension that answers one question before you post a link: **has this page already been shared?**

One click on the toolbar button checks the current page against:

- **Hacker News**
- **Lemmy**, on servers you choose
- **Lobsters**
- **Mastodon**, on servers you choose, plus the page's own Fediverse account
- **Reddit**

Results appear in the toolbar popup or in a new tab, and can be saved as a Markdown file.

> **Status: early, unpublished and AI-assisted.** It works for its author in Firefox, but it has not had an independent code review. See [Provenance](#provenance).

## Try it

Requires Firefox 128 or newer.

1. Open `about:debugging#/runtime/this-firefox` and choose **Load Temporary Add-on…**.
2. Select `src/manifest.json` from a clone of this repository, or the zip produced by `npm run build`.
3. Open the extension's settings page and switch on the places you want to check (see below).
4. Visit a page and click the toolbar button.

A temporary add-on disappears when Firefox restarts.

## Settings

| Place | What it needs |
| --- | --- |
| Hacker News | Nothing. On by default. |
| Lobsters | Nothing. On by default. Asks `lobste.rs` for permission when you press Save. |
| Lemmy | A list of servers, one per line. No login. |
| Mastodon | A server and an access token per row (Preferences → Development → New application, scopes `read:search` and `read:statuses`). Without a token only trending links can be checked. |
| Mastodon: the page's own account | On by default. Reads the page for a Fediverse profile and scans that account's recent public posts on its own server. No token is sent there. |
| Reddit | Off by default. Uses your Firefox session's `reddit.com` cookies; without them Reddit answers HTTP 403. |

Other options: show results in the popup (default) or a new tab; colours for the results tab (match system, light or dark); and a container for the results tab (see [docs/sources.md](docs/sources.md#containers-and-cookies)).

**Save** downloads the results on screen as a Markdown file. In the popup it sits in the middle of the foot, between **Details** and **Settings**. In the results tab it sits to the right of the headline.

The Markdown is written to paste cleanly into both old and new Reddit. Fediverse handles are explicit links (Reddit reads a bare `@user@host` as an email address), and nothing is indented: each post is a bold linked title, one bullet of facts, then a flush-left quote.

## Privacy

Nothing runs in the background. When you click the toolbar button, the address of the current page is sent to the places you have switched on, and nowhere else.

- Your Mastodon token is only ever sent to the server on the same settings row. Servers found on web pages never receive it.
- No cookies are sent anywhere, except to `reddit.com` when Reddit is switched on.
- The page is read (for a Fediverse profile) only at the moment you click.
- Post text from other sites is displayed as plain text, never as HTML.

## How each place is checked

Short version here; endpoints, quirks and what has and hasn't been verified are in **[docs/sources.md](docs/sources.md)**.

| Place | Request |
| --- | --- |
| Hacker News | Algolia's public search, restricted to the URL field |
| Lemmy | `/api/v3/search` with `type_=Url` |
| Lobsters | `/stories/url/all.json?url=` |
| Mastodon | `/api/v2/search` (with your token), `/api/v1/timelines/link`, and the page's own account's timeline |
| Reddit | `/api/info.json?url=`, trying several spellings of the URL |

Every result is re-checked in the extension, so a loose match on the server doesn't become a false positive.

## Development

```sh
npm install
npm test        # unit and DOM tests, using mocked networks and a mocked browser
npm run lint    # Mozilla's linter (web-ext lint)
npm run build   # writes a zip to dist/
npm start       # launches Firefox with the extension loaded
```

Layout:

| Path | Role |
| --- | --- |
| `src/manifest.json` | Manifest V3, Firefox only (event-page background script) |
| `src/background.js` | Decides what the toolbar button does: popup, or a results tab |
| `src/lib.js` | URL handling and every network source |
| `src/ui.js` | Shared rendering for the popup and the results tab, and the Save button |
| `src/markdown.js` | Builds and downloads the Markdown file |
| `src/popup.*`, `src/results.*`, `src/options.*` | The three pages |
| `test/` | One file per area; `test/run.js` runs them all |

The extension has no runtime dependencies. `jsdom` and `web-ext` are development tools only.

### Known issues

- `npm run lint` currently reports two publishing-related items (the extension's name is longer than 45 characters, and `data_collection_permissions` is missing from the manifest). Neither affects loading it temporarily.
- `npm audit` reports vulnerabilities in `web-ext`'s own dependency tree (the Firefox launcher and the Android deploy helper). They are development-time only and nothing from `node_modules` ships in the extension.
- The tests use mocked networks and a mocked browser. They check the logic, not the live sites, and not Firefox itself.
- New Reddit may display the `##` headings in the saved Markdown as level 1. That is accepted for now.
- The Save button downloads a `data:` URL through an `<a download>` link. That has been tested only in a simulated page.

## Provenance

This extension was vibe-coded by an AI assistant – Anthropic Claude: 

- mostly Sonnet 5.5 (a mixture of medium and extra efforts)
- for one of the more recent prompts, I switched down to Haiku 4.5. 

In addition to prompting Claude: I ran various tests in Firefox, based on experience with Reddit. Some of the tests were to compensate for understandable restrictions by Reddit. 

## Acknowledgements

[ReadIt](https://addons.mozilla.org/addon/readit-read-it-on-reddit/) (MIT licensed): its approach of probing several spellings of a URL against Reddit's `info.json`, then matching strictly, was learned by reading its code. No code was copied.

[Newsit](https://newsit.benwinding.com/) by Ben Winding, which works with Hacker News and Reddit, and prompted the question of how to support Lobsters. Newsit is, distinctively:

- more capable with Hacker News and Reddit – it has the option to post
- not limited to Firefox.

## Licence

[MIT](LICENSE)
