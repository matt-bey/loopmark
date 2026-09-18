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

### Installing from a hosted page

The install page is published at
**<https://matt-bey.github.io/loopmark/>** — open it and drag the button,
no clone or toolchain required.

That page is published by CI only after the zero-network gate, the fixture
scrub and the dist/-matches-source check have all passed, and it uploads the
committed bytes rather than a fresh build — so what you drag from the hosted
page is exactly what is in this repository.

**Verify it if you care**, which you should, because a bookmarklet is code you
grant the rights of every page you run it on:

```
shasum -a 256 dist/loopmark.bookmarklet.txt   # compare to dist/CHECKSUMS.txt
```

The hosted install page prints the same hash and a **Source ID**, which is a
digest of `src/`. Both are reproducible from any checkout, so a hosted install
stays auditable rather than something you simply trust. The Source ID also
appears in the overlay's Details pane — a bookmarklet is never updated after you
drag it, so that is how you tell which build produced an export.

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
| Headings | Keyed off `role="heading"` + `aria-level`, **not** tag nesting -- a real Loop page has 26 ARIA headings and essentially no `<h1>`-`<h6>`. This is what fixes the `- ` prefix artifact. |
| Heading levels | The page title owns the document's only `#`, and body headings shift down one level, so Loop's "Heading 1" becomes `##`. Loop pages routinely have several `aria-level="1"` headings, which would otherwise produce several competing H1s. Clamped at `######`. |
| Paragraphs | Soft lines within a paragraph join with a Markdown hard break. |
| Lists | Ordered, unordered, nested. Loop never nests lists in the DOM -- depth is `aria-level`, and numbering is a CSS custom property, since Loop emits no `<ol>` at all. |
| Checklists | `- [ ]` / `- [x]` from `role="checkbox"` + `aria-checked` on the list marker. Nested items indent to the content column, not past the checkbox. |
| Tables | GFM pipe tables. Cells run the full block pipeline, so paragraphs and lists inside a cell survive as `<br>`-joined content. Pipes escaped, ragged rows padded, the row-number gutter dropped. |
| Voting tables | The tally is recovered from the vote button's accessible name, so a Votes column exports as `3 votes` rather than blank. |
| Mentions | The display name only. Loop's avatar carries the person's initials and is `aria-hidden`, so a naive read gives "JPJake Poe". No identity resolution. |
| Callouts | `> [!NOTE]`. Loop's callout is `[data-testid="block-callout-component"]`, wrapped in a Fluent provider whose class also says "callout" -- matching both wraps the output twice. |
| Code | Inline and fenced. The language comes from Loop's toolbar combobox, so a Mermaid diagram fences as ```` ```mermaid ```` with its source intact. A block Loop had not rendered says so instead of exporting its own buttons. |
| Maths | `$...$` / `$$...$$` from the LaTeX source in the MathML annotation. KaTeX renders each equation twice -- once for screen readers, once for sight -- so reading the text gave every equation two or three times over. |
| Links | Recovered from Loop's `<span role="link" title="URL">` markup. |
| Emphasis | Bold, italic, strikethrough, including style-only formatting. |
| Callouts | Mapped to GitHub Alerts (`> [!WARNING]`) where the type is detectable. |
| Images | `![alt](url)` plus a footnote noting the URLs are access-controlled. A pasted image is an inline base64 `data:` URI, routinely hundreds of KB, and is replaced with a placeholder. |
| Mentions | Flattened to the plain display name. No identity resolution. |
| Loop components | Best-effort static snapshot in a labelled fenced block. |
| Comments | GFM footnotes. A `[^c1]` marker sits at the paragraph the thread annotates and the conversation is collected at the foot of the document, so the page still reads straight through. **The comments pane must be open** -- Loop puts threads in the DOM only while it is, and loopmark says so when it finds comments it could not read. |

| Page title | Read from `#headerContainer`, where Loop renders it as a miniature page of its own -- not an `<h1>`, and with no "title" in its class name. Becomes the document's `# ` heading. |

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

- **Comment replies are not captured.** Loop's gutter renders only the message
  that opened each thread; replies exist as a count and one avatar per replier.
  loopmark will not click a thread open, because that marks it as read for you
  and the read-only rule outranks completeness -- so an export says
  `2 replies from … not captured` rather than presenting a truncated
  conversation as a whole one.
- **A comment's position is inferred, not recorded.** Nothing in Loop's markup
  links a thread to the text it refers to; the only signal is that Loop lines
  the gutter card up with its anchor. loopmark matches on that geometry and
  falls back to an unanchored `## Comments` section whenever the match would be
  a guess -- including offline, where `npm run try` has no layout to measure.

- **It is a DOM scraper.** Microsoft can break it with any UI change, without
  notice. Everything Loop-specific is isolated in
  [`src/selectors.ts`](src/selectors.ts) so repairs are a one-file change.
- **Very long pages may truncate.** Loop virtualizes aggressively -- a saved
  page sitting at the top of its scroll had 640 `[hidden]` elements and three of
  its four code blocks were not in the DOM at all. loopmark scrolls to force
  rendering, but that scroll is capped at 8 seconds so a huge page degrades
  rather than hanging your tab. It counts the tables and code blocks present in
  the page against those it converted and warns about the difference, so a
  partial export is never presented as a complete one. **If you see that
  warning, scroll the whole page yourself and run it again.**
- **Collapsed sections are not exported, by design.** While a heading section
  is collapsed, Loop does not render its content at all -- a code block inside
  one contains its toolbar and no code. loopmark will not expand it for you:
  Loop syncs collapsed state through Fluid, so opening a section may be a write
  to the shared document and change what your collaborators see, and loopmark
  is strictly read-only. Instead it marks the spot in the output and names the
  sections in the warnings, so you can expand the ones you care about and
  export again.
- **Live components become static snapshots.** A voting table exports as the
  text it displayed at that moment, in a fenced block. Nothing stays live.
- **Images are links, not files.** They point at their original Loop URLs, which
  are access-controlled and will not render for anyone outside an authenticated
  session — including in your Markdown viewer. Downloading the bytes would mean
  making network requests, which loopmark does not do.
- **Closed shadow roots would break it entirely.** Every shadow root on Loop
  today is open, and in fact they all belong to the spell-check underlay rather
  than to content -- see [`spikes/RESULTS.md`](spikes/RESULTS.md). If Loop ever
  moves content into a closed root, no bookmarklet or extension can read it and
  this project ends. `spikes/probe.js` checks for that.
- **Version history and page metadata are not exported.** The document body and
  its comments, and nothing else.
- **A Loop table-of-contents block is dropped on purpose.** It is generated
  from headings that are already in the output, and its links point at
  `loop.cloud.microsoft` URLs that resolve for nobody reading the Markdown.
  Remove `.scriptor-table-of-contents-root` from `EXCLUDE_SELECTORS` to keep it.
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

## Checking the output without a browser

Save a Loop page from the browser (**Save page as… → Web page, complete**),
scrolling to the bottom first so Loop renders everything, then:

```
npm run try -- "~/Downloads/My Page.html"          # print to stdout
npm run try -- "~/Downloads/My Page.html" out.md   # write to a file
```

Diagnostics go to stderr, so `npm run try -- page.html > out.md` gives you clean
Markdown with the warnings still on screen. This is the fastest way to confirm a
selector change against real markup, and the only way to do it without a live
Loop session. Two things it cannot tell you: anything Loop had virtualized when
you saved is absent, and jsdom loads no stylesheets, so emphasis Loop expresses
through a CSS class alone is missed. The real bookmarklet reads
`getComputedStyle` in a real browser and does better on both counts.

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
