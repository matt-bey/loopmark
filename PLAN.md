# loopmark — Build Plan / Claude Code Handoff

> **Project name:** `loopmark`
> A self-contained bookmarklet that converts the Microsoft Loop page you're looking at into clean GitHub-flavored Markdown and hands it to your clipboard.
>
> The name is doing triple duty: **Loop** + **Mark**down + book**mark**let.

---

## 0. Read this first

You are building a new public repository from scratch. This document is the spec. Where it
says **GATE**, stop and report findings before continuing — those steps can invalidate the
rest of the plan.

The single most important non-functional property of this project is: **the bookmarklet makes
zero network requests.** Everything else is negotiable. That property is what makes it
defensible to a corporate security review, and there is a CI check in Phase 5 that enforces it.

---

## 1. Problem statement

Microsoft Loop has no content API. There is no Graph endpoint to read a Loop page's content,
no bulk export, and no Markdown export. The only built-in options are print-to-PDF and
copy-paste, and copy-paste mangles structure (headings come out as list items with a `- `
prefix, tables break, images are lost).

Reading Loop workspace pages via the Microsoft Graph file layer is possible — Loop pages live
in SharePoint Embedded containers and `?format=html` can convert `.loop` files — but it
requires `FileStorageContainer.Selected` admin consent and is undocumented as a Loop reading
strategy. That path is closed for anyone without tenant admin cooperation.

Browser extensions that do this exist, but many enterprises block extension installation
outright.

**loopmark fills the remaining gap:** a bookmarklet needs no install, no admin consent, no
extension approval, and no server. It runs in the user's already-authenticated session,
reads only the DOM, and produces Markdown.

### Primary use case

Getting a Loop page — typically architecture discussion notes or requirements planning — into
a form that can be pasted into an LLM, committed to a wiki, or archived as text.

---

## 2. Non-goals

Be strict about these. Scope creep here turns a defensible 300-line tool into a liability.

- **No writing back to Loop.** Read-only, structurally. Never call anything mutating.
- **No network calls of any kind.** No CDN imports, no telemetry, no image downloading, no
  update checks. See §7.
- **No authentication handling.** It runs in the session the user already has.
- **No bulk/workspace export.** One page, the one on screen. Multi-page crawling means
  navigation automation, which is a different and much more fragile product.
- **No image extraction.** Images become Markdown references to their existing (usually
  auth-gated) URLs, with a note in the output. Downloading bytes would require network calls.
- **Not a Loop API replacement.** It is a scraper of rendered DOM and should say so plainly.

---

## 3. GATE — Phase 0: feasibility spike

**Do this before writing any project code.** Loop renders content inside shadow roots. If
those roots are `closed`, this project is impossible and everything below is wasted effort.

Produce a short standalone probe script (`spikes/probe.js`) that the user pastes into the
devtools console on an open Loop page. It should report:

1. Whether shadow roots are present in the page at all.
2. For each one found, whether it is reachable (`el.shadowRoot !== null` implies `open`).
3. The depth of shadow nesting.
4. A count of text-bearing nodes found with a shadow-piercing walk vs. a plain
   `document.querySelectorAll('*')` walk — the delta shows how much content a naive
   approach would miss.
5. Whether `role="heading"` / `aria-level` attributes are present on headings (this is the
   signal we want to key off instead of tag nesting — it's what fixes the `- ` prefix bug).
6. Whether the page appears virtualized: does the node count change after scrolling to the
   bottom?

**Report results and stop.** If any shadow root is closed, say so and propose alternatives
rather than continuing.

### Reference prior art

`github.com/stuffbucket/loopd` (MIT) solves a similar problem as a devtools-console script.
Read its source for selector knowledge — how it locates the content root and expands collapsed
sections. That discovery work is the valuable part.

Do **not** copy its architecture. It loads the remark ecosystem from `esm.sh` at runtime,
which violates our zero-network rule and is the most likely thing to be blocked by CSP. We
write our own converter. Its README also documents that Safari blocks bookmarklets on Loop
pages, which is a known limitation to carry forward.

If you reuse any non-trivial code, honor the MIT license with attribution in `NOTICE`.

---

## 4. Architecture

```
source (TypeScript, modular, readable)
    ↓  esbuild — bundle, minify, IIFE, no externals
single JS blob
    ↓  encode step — URI-encode, prefix with javascript:
dist/loopmark.bookmarklet.txt   ← the thing you drag to your bookmarks bar
dist/install.html               ← a local page with a draggable link + instructions
```

The user drags the link from a locally-opened `install.html` onto their bookmarks bar. No
server, no hosting. `install.html` must work opened via `file://`.

### Runtime flow

1. Click bookmarklet → IIFE executes in page context.
2. Guard: if not on a Loop host, show a friendly overlay saying so and exit.
3. Prepare the DOM: expand collapsed sections, scroll to force virtualized content to render,
   wait for settle.
4. Walk the DOM, piercing open shadow roots, building an intermediate node tree.
5. Convert the tree to GitHub-flavored Markdown.
6. Render an overlay containing a `<textarea>` with the Markdown, pre-selected.
7. Copy button tries `navigator.clipboard.writeText()`, falls back to
   `document.execCommand('copy')` on the selected textarea, and if both fail just leaves the
   text selected with a "press Ctrl+C" hint.

Never write to the clipboard silently on load. The user should see the output before it goes
anywhere — given how mangled copy-paste is today, eyeballing the result is a feature.

---

## 5. Implementation phases

### Phase 1 — DOM acquisition (`src/acquire.ts`)

- `pierceQuerySelectorAll(root, selector)` — recursive walker that descends into
  `element.shadowRoot` when present. This is the core primitive; unit test it against
  synthetic shadow trees.
- `expandCollapsed()` — find and click collapse/disclosure toggles. Prefer
  `[aria-expanded="false"]`. Idempotent, and must not click anything that could mutate content.
  Maintain an explicit allowlist of what's safe to click; never click generic buttons.
- `forceRender()` — scroll the content container to the bottom in steps, then back to top,
  with a short settle delay between steps, to defeat virtualization.
- `findContentRoot()` — locate the page content container. Expect this to be the most
  brittle function in the codebase. Implement it as an ordered list of candidate strategies
  with fallbacks, log which one matched, and make it trivially easy to add new candidates.

Everything selector-dependent lives in one file: `src/selectors.ts`. When Microsoft ships a
UI change, that is the only file that should need editing. Comment each selector with what it
targeted and when it was last verified.

### Phase 2 — Converter (`src/convert.ts`)

Hand-rolled HTML → GFM. No dependencies. Handle, in priority order:

| Element | Notes |
|---|---|
| Headings | Key off `role="heading"` + `aria-level`, **not** tag nesting. This is what fixes the `- ` prefix artifact. Fall back to `h1`–`h6`. |
| Paragraphs | Collapse whitespace, preserve intentional breaks as two-space or `\n\n`. |
| Lists | Ordered, unordered, nested. Compute depth from real nesting, not indentation styles. |
| Checklists | `- [ ]` / `- [x]` from checkbox state. |
| Tables | GFM pipe tables. Escape pipes in cell content. Handle ragged rows by padding. |
| Code | Inline backticks; fenced blocks with language when detectable. |
| Links | `[text](url)`. Strip tracking params? No — leave URLs untouched, be faithful. |
| Emphasis | bold, italic, strikethrough. Nested emphasis must not produce broken delimiters. |
| Callouts | Map Loop callouts to GitHub Alerts (`> [!NOTE]`, `> [!WARNING]`, etc.) where the type is detectable; plain blockquote otherwise. |
| Images | `![alt](url)` pointing at the original URL, plus a collected footnote listing image URLs so the user knows they're auth-gated and won't render elsewhere. |
| Mentions / people chips | Render as plain text name. Do not attempt to resolve identities. |
| Loop components (tasks, votes, etc.) | Best-effort: render the visible text content in a fenced block tagged with the component type, prefixed by a comment noting it was a live component and is now a static snapshot. |

Escape Markdown special characters in text content. Emit a trailing provenance block:
page title, source URL, and export timestamp, as an HTML comment so it survives rendering.

### Phase 3 — Output overlay (`src/ui.ts`)

- Shadow-DOM-isolated overlay so Loop's styles can't bleed in and ours can't bleed out.
- Textarea with the Markdown, monospace, pre-selected on open.
- Buttons: Copy, Download `.md`, Close. Download uses a `Blob` + object URL — that's local,
  not a network call.
- Show character and line count, plus a warning if the output looks suspiciously short
  relative to the number of nodes walked (a cheap truncation detector).
- `Esc` closes. Clicking the backdrop closes.
- Render diagnostics behind a "Details" disclosure: which content-root strategy matched, how
  many shadow roots were pierced, how many nodes were skipped as unrecognized. This makes bug
  reports actionable without users needing devtools.

### Phase 4 — Build (`scripts/build.mjs`)

- esbuild → IIFE, minify, `target: es2020`, no externals, no sourcemap in the shipped blob.
- Encode: `javascript:` + `encodeURIComponent(bundle)`.
- **Size check:** fail the build over 60 KB encoded. Browsers vary in bookmark URL length
  tolerance; staying small avoids the question. Report the size on every build.
- Generate `dist/install.html` with the draggable anchor, install instructions per browser,
  and a plain-text copy of the URL for people who'd rather paste it into the bookmark editor.
- `npm run build` produces everything. `dist/` is committed so users can grab the bookmarklet
  without a toolchain.

### Phase 5 — Tests and the security gate

- **vitest** for unit tests. Converter tests run against HTML fixtures in `test/fixtures/`.
- Fixtures must be **synthetic or fully scrubbed**. This is a public repo. No real page
  content, no internal project names, no user names, no tenant identifiers, no real URLs.
  Add a CI check that greps fixtures for the company domain and fails if found.
- **Zero-network CI check** — the important one. A test that reads the built bundle and
  asserts it contains none of: `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`,
  `EventSource`, `import(`, `importScripts`, `new Worker`. Fail the build on any hit. This
  check existing, and being visible in CI, is the argument you hand to a security reviewer.
- Lint + typecheck in CI.

---

## 6. Repository layout

```
loopmark/
├── README.md
├── LICENSE                 # MIT
├── NOTICE                  # attribution for any reused MIT code
├── SECURITY.md             # threat model, reporting
├── CONTRIBUTING.md
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts             # entry, orchestration, host guard
│   ├── selectors.ts        # ALL Loop-specific selectors, heavily commented
│   ├── acquire.ts          # shadow-piercing walk, expand, force-render
│   ├── convert.ts          # HTML → GFM
│   ├── ui.ts               # overlay
│   └── types.ts
├── scripts/
│   ├── build.mjs
│   └── check-no-network.mjs
├── spikes/
│   └── probe.js            # Phase 0 feasibility probe, kept for re-verification
├── test/
│   ├── fixtures/           # synthetic/scrubbed HTML only
│   └── *.test.ts
├── dist/                   # committed
│   ├── loopmark.bookmarklet.txt
│   └── install.html
└── .github/workflows/ci.yml
```

---

## 7. Security posture

This tool runs arbitrary JavaScript inside an authenticated corporate SaaS session. That is
exactly the shape of a self-XSS attack, and it deserves to be treated seriously rather than
waved off. The design compensates in specific ways, and `SECURITY.md` should state them
plainly:

- **No network egress.** Nothing the bookmarklet reads can leave the browser. Enforced by CI,
  not just by policy. This is the load-bearing claim.
- **Read-only.** No mutating DOM operations beyond expanding disclosure widgets and mounting
  an overlay. No form submission, no API calls, no storage writes.
- **No credential access.** Never read `document.cookie`, `localStorage`, `sessionStorage`,
  or anything token-shaped. Add these to the CI grep list.
- **Auditable.** The source is small, unminified, TypeScript, and in a public repo. The
  minified blob is reproducible from source via `npm run build`.
- **No dependencies at runtime.** Build-time devDependencies only. Nothing in the shipped
  artifact that wasn't written in this repo.

`SECURITY.md` should also be honest about what is *not* mitigated: anyone who can convince a
user to paste a *different* `javascript:` URL has full session access, and this project
normalizes the gesture of putting a bookmarklet on the bar. Recommend that adopters pin to a
reviewed commit, build it themselves, and diff `dist/` against a local build rather than
trusting a pasted string from anywhere.

---

## 8. README requirements

The README is the adoption surface. It should contain:

- One-sentence description and a screenshot/GIF of the overlay.
- The problem statement in three sentences, with the honest framing: Loop has no content API,
  this is a DOM scraper, it will break when Microsoft changes their UI.
- Install: open `dist/install.html` locally, drag to bookmarks bar.
- Browser support table. Chrome and Edge expected to work; Safari known to block bookmarklets
  on Loop pages; Firefox untested — verify and record.
- A **Limitations** section that is genuinely candid: virtualized content may truncate on very
  long pages, live components become static snapshots, images are links not files, closed
  shadow roots would break it entirely, and it is unaffiliated with and unsupported by
  Microsoft.
- Security section pointing at `SECURITY.md` and the CI check.
- Troubleshooting: what to do when it returns nothing (usually a selector change — point at
  `src/selectors.ts` and the diagnostics disclosure).

---

## 9. Acceptance criteria

1. Phase 0 probe run and results documented in the repo.
2. `npm run build` produces a working bookmarklet under 60 KB encoded.
3. Dragging from `install.html` and clicking on a Loop page produces an overlay with
   structurally correct Markdown.
4. Headings render as `##`, never as list items. This is the regression test that matters most.
5. Tables round-trip to valid GFM.
6. CI passes: typecheck, lint, unit tests, no-network check, fixture-scrub check.
7. README and SECURITY.md complete and honest about limitations.

---

## 10. Things to ask before you start

- Confirm the Loop host(s) to guard against — `loop.cloud.microsoft` plus any tenant-specific
  hosts in use.
- Ask for scrubbed HTML samples of a heading, a nested list, a table cell, and a callout from
  a real Loop page. `src/selectors.ts` is guesswork without them, and guesswork here is where
  the afternoon goes.
- Confirm org conventions for the public repo: license header style, branch protection,
  commit signing requirements, CODEOWNERS.
- Confirm whether Firefox support matters or Chrome/Edge is sufficient.
