# loopmark

A bookmarklet that converts the Microsoft Loop page you are looking at into clean
GitHub-flavored Markdown and puts it on your clipboard. No install, no extension,
no server, and **zero network requests**.

> The name does triple duty: **Loop** + **Mark**down + book**mark**let.

```
┌──────────────────────────────────────────────────────────────┐
│  loopmark      42 lines · 1,308 characters   [Copied]     ✕  │
├──────────────────────────────────────────────────────────────┤
│  # Architecture Review                                       │
│                                                              │
│  ## Background                                               │
│                                                              │
│  We need a decision on the caching layer by Friday. See      │
│  [the spec](https://example.invalid/spec) for context.       │
│                                                              │
│  - [x] Draft the options                                     │
│  - [ ] Circulate for review                                  │
│                                                              │
│  | Option | Cost | Risk  |                                   │
│  | ---    | ---  | ---   |                                   │
│  | A      | Low  | High  |                                   │
├──────────────────────────────────────────────────────────────┤
│  [Copy Markdown]  [Download .md]          ▸ Details  [Close] │
└──────────────────────────────────────────────────────────────┘
```

## The problem

Microsoft Loop has no content API — no Graph endpoint for page content, no bulk
export, no Markdown export. The only built-in options are print-to-PDF and
copy-paste, and copy-paste mangles structure: headings come out as list items
with a `- ` prefix, tables break, and links are lost. loopmark is a **DOM
scraper**, not an API client, which means it reads what your browser has already
rendered — and it will break when Microsoft changes their UI.

## Install

1. Open [`dist/install.html`](dist/install.html) from a local clone — double-click
   it, or `open dist/install.html`. It works over `file://`; nothing is hosted.
2. Show your bookmarks bar (<kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>).
3. Drag the **loopmark** button onto it.
4. Open a Loop page and click the bookmark.

If dragging doesn't work, `install.html` also shows the raw `javascript:` URL to
paste into a hand-made bookmark.

## What happens when you click it

1. Expands collapsed sections (from a narrow allowlist — see
   [Security](#security)) and scrolls the page to force virtualized content to
   render, then scrolls back to where you were.
2. Reads the rendered DOM, descending into open shadow roots.
3. Converts it to GitHub-flavored Markdown.
4. Copies it to your clipboard and shows it in an overlay.
   <kbd>Esc</kbd>, the ✕, the **Close** button, or a click on the backdrop all
   dismiss it.

## What it handles

| Element | Notes |
| --- | --- |
| Headings | Keyed off `role="heading"` + `aria-level`, **not** tag nesting. This is what fixes the `- ` prefix artifact. |
| Paragraphs | Soft lines within a paragraph join with a Markdown hard break. |
| Lists | Ordered, unordered, nested, including items associated by `aria-owns`. |
| Checklists | `- [ ]` / `- [x]` from checkbox state. |
| Tables | GFM pipe tables. Pipes in cells are escaped, ragged rows padded. |
| Code | Inline and fenced, with the language when Loop exposes it. |
| Links | Recovered from Loop's `<span role="link" title="URL">` markup. |
| Emphasis | Bold, italic, strikethrough, including style-only formatting. |
| Callouts | Mapped to GitHub Alerts (`> [!WARNING]`) where the type is detectable. |
| Images | `![alt](url)` plus a footnote noting the URLs are access-controlled. |
| Mentions | Flattened to the plain display name. No identity resolution. |
| Loop components | Best-effort static snapshot in a labelled fenced block. |

Every export ends with an HTML-comment provenance block recording the page
title, source URL, and export timestamp.

## Browser support

| Browser | Status |
| --- | --- |
| Chrome | Supported |
| Edge | Supported |
| Firefox | Untested — likely works; the clipboard permission model differs |
| Safari | **Blocks bookmarklets on Loop pages.** Paste `dist/loopmark.bundle.js` into the DevTools console instead |

## Limitations

Read this section before relying on the output.

- **It is a DOM scraper.** Microsoft can break it with any UI change, without
  notice. Everything Loop-specific is isolated in
  [`src/selectors.ts`](src/selectors.ts) so repairs are a one-file change.
- **Very long pages may truncate.** Loop virtualizes its content; loopmark
  scrolls to force rendering, but that scroll is capped at 8 seconds so a huge
  page degrades rather than hanging your tab. The overlay warns when the output
  looks suspiciously short for the number of elements walked.
- **Live components become static snapshots.** A voting table exports as the
  text it displayed at that moment, in a fenced block. Nothing stays live.
- **Images are links, not files.** They point at their original Loop URLs, which
  are access-controlled and will not render for anyone outside an authenticated
  session — including in your Markdown viewer. Downloading the bytes would mean
  making network requests, which loopmark does not do.
- **Closed shadow roots would break it entirely.** Loop currently uses open
  shadow roots, which are readable. If that changes, no bookmarklet or extension
  can read the content and this project ends. `spikes/probe.js` checks for this.
- **Comments, version history, and page metadata are not exported.** Only the
  document body.
- **Unaffiliated with Microsoft.** Not supported, endorsed, or acknowledged by
  them. Check your organization's acceptable-use policy before adopting it.

## Security

loopmark runs JavaScript inside an authenticated corporate session. That is the
shape of a self-XSS attack, and it deserves a real answer rather than a
reassurance. The short version:

- **No network egress.** Not a single request. Enforced by
  [`scripts/check-no-network.mjs`](scripts/check-no-network.mjs), which greps the
  *built artifact* — not the source — and fails CI on any hit.
- **Read-only.** No mutating operations beyond expanding disclosure widgets from
  a narrow allowlist and mounting an overlay. It never writes to your Loop page.
- **No credential access.** Never reads cookies, `localStorage`, or
  `sessionStorage`. Also in the CI grep list.
- **No runtime dependencies.** Nothing in the shipped artifact was written
  outside this repo.

The full threat model, including what is *not* mitigated, is in
[SECURITY.md](SECURITY.md). Read it before putting this on your bookmarks bar.

## Troubleshooting

**It produced nothing, or almost nothing.** Almost always a Loop UI change.
Open the **Details** disclosure in the overlay — it reports which content-root
strategy matched, how many elements were walked, how many shadow roots were
pierced, and any unrecognized tag names. Then re-run `spikes/probe.js` in the
DevTools console to see the current markup, and add a candidate to
[`src/selectors.ts`](src/selectors.ts).

**Headings came out as `- ` bullets.** That is the bug this project exists to
fix, and there is a test asserting it cannot happen. If you see it, please open
an issue with the Details output — Loop has changed something fundamental.

**The clipboard didn't get it.** The async Clipboard API needs a recent user
gesture, and forcing virtualized content to render can outlast it. The overlay
says so, and the text is pre-selected — press <kbd>Ctrl/Cmd</kbd>+<kbd>C</kbd>,
or click **Copy Markdown**, which always works.

**Nothing happened at all.** You may be on Safari (see the support table), or
your organization may block `javascript:` bookmarks by policy.

## Development

```bash
npm install
npm run verify   # typecheck, lint, test, build, and both security gates
```

`dist/` is committed so people can use the bookmarklet without a toolchain. CI
rebuilds it and fails if the result differs from what's checked in, so the blob
is always reproducible from the source you can read.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE). Selector knowledge derived from the MIT-licensed
[stuffbucket/loopd](https://github.com/stuffbucket/loopd); see [NOTICE](NOTICE).
