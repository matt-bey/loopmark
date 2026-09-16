# Phase 0 — feasibility probe results

`spikes/probe.js` answers the six questions that determine whether loopmark is
possible at all. **Re-run it whenever Loop appears to have changed**, and paste
the updated report below.

## How to run it

1. Open a Microsoft Loop page in Chrome or Edge.
2. Open DevTools (<kbd>Cmd/Ctrl</kbd>+<kbd>Opt/Shift</kbd>+<kbd>I</kbd>) → Console.
3. If prompted, type `allow pasting` and press Enter.
4. Paste the entire contents of [`probe.js`](probe.js) and press Enter.
5. Wait ~4 seconds. The report prints and is copied to your clipboard.

The probe is read-only. It does not click anything, does not write to the page,
and restores your scroll position when it finishes.

## The six questions

| # | Question | Why it matters |
| --- | --- | --- |
| 1 | Are shadow roots present? | Determines whether a plain DOM walk suffices. |
| 2 | Are they **open**? | **If any content root is closed, this project is impossible.** `element.shadowRoot` returns `null` for both "no root" and "closed root", so the probe infers closed roots from elements that render a box but expose no children or text. |
| 3 | How deeply are they nested? | Bounds the recursion in `pierceQuerySelectorAll`. |
| 4 | Pierced vs. plain text-node count | The delta is how much content a naive walk would miss. |
| 5 | Are `role="heading"` / `aria-level` present? | This is the signal that fixes the `- ` prefix bug. Without it we fall back to tag names and class-name heuristics. |
| 6 | Does node count change after scrolling? | Tells us whether `forceRender()` is load-bearing or theatre. |

It also reports the scored content-root candidates, collapsed disclosure
widgets, and a tag/role/`data-testid` inventory — the raw material for
`src/selectors.ts`.

## Status

> **Answered on 2026-09-16 from a saved Loop page**, not from `probe.js`.
>
> A complete Loop page ("Save page as… → Web page, complete") was inspected
> offline: 2.9 MB of markup, 8 tables, 4 code blocks, 166 list items. That
> answers every question below except Q4 and Q6, which need a live page because
> they measure what changes when you scroll.
>
> This is strictly better evidence than the probe for questions about *markup*,
> and strictly worse for questions about *behaviour*. Running `probe.js` on a
> live page is still worth doing, but it is no longer a gate: the selectors in
> `src/selectors.ts` have been rewritten against observed markup and are
> exercised by fixtures copied from it (`test/fixtures/loop-*.html`).

## Results

### Q1 — shadow roots present

**Yes, but not in content.** 59 declarative shadow roots, every one belonging to
`<editor-squiggler>` — the Microsoft Editor spell-check underlay, which is
`aria-hidden` and carries no document text. Document content is entirely in the
light DOM.

Composed-tree traversal is therefore *not* load-bearing on today's Loop. It is
kept because it costs nothing, is already tested, and Loop is a moving target.

### Q2 — open or closed

**All open. Zero closed roots.** The project is possible.

### Q3 — nesting depth

**One level**, and only inside the squiggler. No nesting in content.

### Q4 — pierced vs. plain walk

**Not measurable offline** — needs a live page. Given Q1, the delta is expected
to be zero for content and non-zero only for spell-check chrome.

### Q5 — heading signals

**Present and essential.** 26 of 26 headings carry both `role="heading"` and
`aria-level`. There is exactly one `<h2>` on the page and no `<h1>`, `<h3>`–`<h6>`
at all.

Headings are `<div class="scriptor-paragraph" role="heading" aria-level="N">` —
note that they carry `scriptor-paragraph` too. `classify()` testing `role` before
the paragraph class is what keeps every heading from exporting as body text.

### Q6 — virtualization

**Heavy, and it costs content.** 640 elements are `[hidden]` in a page that was
sitting at the top of its scroll. Three of the four code blocks were hidden, and
their source was not in the DOM at all — only a language chip and a
"Show more lines" button.

`forceRender()` is load-bearing, not theatre. `convert()` now counts the tables
and code blocks present against those it emitted and warns on any shortfall, so
a partial export is never reported as a complete one.

## What the saved page changed in the code

| Finding | Consequence |
| --- | --- |
| Components are hosted *inside* a `.scriptor-paragraph` | Tables exported as run-on text. The headline bug. |
| Table classes are hashed CSS-module names (`s3qI48J2O36ukhamGiQIJQ==`) | Any class-based table selector is worthless; `data-automation-type` is the stable hook. |
| `data-automation-type="Tablero"` hosts the table | Real `<table>`/`<tr>`/`<td>` markup underneath, which the converter already handled. |
| An `aria-hidden` "column grabber" table mirrors each real one | Excluded, or every table would double. |
| First cell of every row is an `aria-hidden` row-number gutter | Excluded, or every table gains a phantom column. |
| `scriptor-code-editor` marks *inline* code, not blocks | Every inline snippet became its own fenced block. |
| `scriptor-code-editor-background-color-set` is on *headings* | A prefix match on the above would render every heading as inline code. |
| Lists are never nested in the DOM; depth is `aria-level` | All nesting was lost; every item became its own list. |
| There are **no `<ol>` elements**; numbering is a CSS custom property | Every numbered list exported as bullets. |
| `<br class="scriptor-EOP">` ends every paragraph | A stray `\` on every line of output. |
| Styled runs are split across sibling spans | `**One** **Runtime** **Image****s**`. |
| Pasted images are base64 `data:` URIs | One 234 KB line; 2.9 MB of page became 1.29 MB of Markdown. |
| Buttons sit inside tables and code blocks | A literal "New" after every table, "Show more lines" inside every fence. |

Net effect on the sample page: **1.29 MB of run-on text became 16 KB with eight
correct GFM tables, nested and numbered lists, and labelled code fences.**
