# Security

## What this thing actually is

loopmark is a bookmarklet. Clicking it executes JavaScript in the origin of the
page you are on, inside your authenticated session, with your privileges.

That is precisely the shape of a self-XSS attack. Any honest security document
for this project has to start there rather than with reassurance. What follows
is the threat model, the specific mitigations, and — more importantly — what is
**not** mitigated.

## Threat model

| Asset | Threat | Mitigation |
| --- | --- | --- |
| Loop page content | Exfiltration to a third party | No network egress of any kind. Enforced by CI against the built artifact. |
| Session cookies / tokens | Theft | Never read. `document.cookie`, `localStorage`, `sessionStorage`, `indexedDB` are all in the CI ban list. |
| The Loop document itself | Unintended modification | Read-only by construction. The only click is "Show more lines" inside a code block, double-gated by a veto list. Collapsed sections are never expanded, because that state syncs to collaborators. |
| The user's browser | Persistence / privilege escalation | No storage writes, no service worker, no extension surface. Everything ends when the tab closes. |
| The supply chain | A compromised dependency shipping in the blob | Zero runtime dependencies. Build-time devDependencies only, and the built artifact is grepped for network APIs regardless. |

## Mitigations, specifically

### 1. No network egress — the load-bearing claim

loopmark makes no network requests. Not telemetry, not update checks, not image
fetching, not a CDN import. Nothing it reads can leave your browser.

This is enforced mechanically, not by policy.
[`scripts/check-no-network.mjs`](scripts/check-no-network.mjs) scans both
`dist/loopmark.bundle.js` and the decoded `dist/loopmark.bookmarklet.txt` for:

```
fetch(         XMLHttpRequest   WebSocket       sendBeacon      EventSource
import(        importScripts    new Worker      new SharedWorker
serviceWorker  document.cookie  localStorage    sessionStorage
indexedDB      credentials:     form.submit(
```

Any hit fails the build. The check runs on every push and pull request. It scans
the **built artifact** rather than the source deliberately: source review catches
what a human reads, but the bundle is what actually executes in your session.

This check existing, and being visible in CI, is the argument to hand a security
reviewer. Please do not add exceptions to it. If a feature needs one, the feature
is wrong for this project.

### 2. Read-only with respect to Loop

loopmark never writes to your Loop document. It performs exactly three kinds of
DOM mutation, all of them local and reversible:

1. **Scrolling** the content container to force virtualized rows to render — and
   restoring your original scroll position afterwards.
2. **Clicking "Show more lines"** inside a code block that is already on
   screen. This is the riskiest operation in the tool, so it is double-gated:
   an element must match the narrow allowlist in
   [`src/selectors.ts`](src/selectors.ts) **and** survive a veto list that
   rejects anything whose label, title, class, or text matches `delete`,
   `remove`, `share`, `invite`, `publish`, `send`, `move`, `rename`, `new`,
   `add`, `create`, `insert`, `comment`, `reply`, `resolve`, `settings`, or
   `sign out`. It never clicks a generic button and never clicks the same
   element twice, with a hard cap of 200 clicks total.

   **Collapsed heading sections are deliberately excluded from that
   allowlist.** Their content is genuinely unreachable while collapsed, but
   Loop syncs collapsed state through Fluid, so opening a section may be a
   write to the shared document and visible to collaborators. Completeness
   does not outrank read-only. loopmark names those sections in its output and
   warnings instead; expanding them is the reader's decision to make in Loop.
3. **Mounting one custom element** (`<loopmark-overlay>`) with an open shadow
   root, removed when you close it.

There is no form submission, no API call, no storage write.

### 3. No credential access

loopmark never reads cookies, `localStorage`, `sessionStorage`, `indexedDB`, or
anything token-shaped. It relies entirely on the session your browser already
has, and never looks at the credentials backing it. This is in the CI ban list
alongside the network APIs.

### 4. Auditable and reproducible

The source is small, unminified, TypeScript, and public. `dist/` is committed for
convenience, and CI rebuilds it on every run and fails if the result differs from
what is checked in — so the blob on the bookmarks bar is always reproducible from
the code you can read:

```bash
npm ci && npm run build && git diff --exit-code dist/
```

## What is NOT mitigated

Be clear-eyed about these.

### Bookmarklets are an unauthenticated code path

Anyone who can convince you to paste a *different* `javascript:` URL onto your
bookmarks bar has full access to every session you use it in. loopmark does not
make that worse in any technical sense, but it **normalizes the gesture** — and
that is a genuine, unquantifiable social cost of adopting it.

If you adopt loopmark, adopt the habit around it:

- **Pin to a reviewed commit.** Do not track `main` blindly.
- **Build it yourself.** `npm ci && npm run build`, then diff `dist/` against the
  committed artifact.
- **Never paste a bookmarklet string from a chat message, an email, or a wiki**
  — including one claiming to be this project. Generate it from source you
  cloned.

### The exported Markdown is unclassified plaintext

loopmark faithfully exports whatever is on the page, including anything
confidential. Once it is on your clipboard or in a `.md` file, none of this
project's protections apply. The primary use case is pasting into an LLM —
**that is a disclosure to a third party**, and it is on you to know whether the
content permits it.

### It reads the whole visible page

If the content-root heuristics fail, loopmark falls back to exporting
`document.body`, which will include navigation and UI text. The overlay warns
when this happens. It is a correctness problem, not a data-loss one, but it means
the output may contain more than you intended.

### Supply chain at build time

Runtime dependencies are zero, but `esbuild`, `typescript`, `vitest`, and
`eslint` are build-time dependencies with their own trees. A compromised esbuild
could inject code into the bundle. The no-network check would catch network APIs
specifically, but it is a grep, not a proof. Use `npm ci` against a committed
lockfile, and review the lockfile on updates.

### Loop's own behavior

loopmark clicks one kind of control in a live collaborative editor: the
"Show more lines" pager inside a code block. The allowlist and veto list are
designed so this cannot reach a destructive control, but they are pattern
matches against markup Microsoft can change at any time — a future Loop build
could attach that label to something that matters. The residual risk is not
zero. If that is unacceptable for your documents, empty
`EXPANDABLE_ALLOWLIST` in [`src/selectors.ts`](src/selectors.ts) and rebuild;
the only cost is that long code blocks export truncated.

### Hosted distribution

If the install page is published to GitHub Pages, the trust question changes
shape. The bookmarklet itself is unaffected — it still makes no network
requests once installed — but the *distribution* channel becomes something to
reason about: anyone who can push to `main`, or who compromises the Actions
workflow, changes what everybody drags next time, and nobody re-reads a
bookmarklet they installed months ago.

Three things keep that honest:

- The publish job `needs` the verify job, so an artifact that fails the
  zero-network gate, the fixture scrub or the dist/-matches-source check is
  never published.
- It uploads the committed `dist/`, not a fresh build, so the hosted payload is
  the reviewed payload.
- `dist/CHECKSUMS.txt` carries the SHA-256 of the exact `javascript:` URL, and
  the install page prints it. `shasum -a 256 dist/loopmark.bookmarklet.txt`
  from a checkout tells you whether the hosted copy matches the source.

What this does **not** solve: hosting makes the tool easy for people who will
never read any of the above. If it is published somewhere public, the audience
grows beyond the people who would notice bad output — weigh that against how
much you want the distribution.

## Reporting a vulnerability

Open a GitHub issue for anything non-sensitive — selector problems, incorrect
output, CI gaps.

For anything that could be exploited (a way to make loopmark exfiltrate data,
mutate a document, or execute attacker-controlled input), please **do not open a
public issue**. Use GitHub's private vulnerability reporting on this repository,
or contact the maintainer directly.

Please include: browser and version, the Details output from the overlay, and a
minimal synthetic reproduction. Do not include real Loop page content, tenant
identifiers, or anything from your organization.
