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

> **NOT YET RUN against a live Loop page.**
>
> Running it requires an authenticated Loop session, which the build environment
> does not have. Until it is run, every entry in `src/selectors.ts` marked
> `UNVERIFIED` is a structural guess, and the entries marked
> `VERIFIED 2026-09-16 via loopd` are second-hand — derived from reading the
> MIT-licensed [stuffbucket/loopd](https://github.com/stuffbucket/loopd), which
> did this discovery work against live pages (see [`NOTICE`](../NOTICE)).
>
> **What this means in practice:** the converter, the traversal, the overlay and
> the security gates are all fully tested and do not depend on the probe. What
> the probe validates is whether `src/selectors.ts` points at the right markup —
> i.e. whether loopmark finds anything to convert.

## Results

<!-- Paste the probe's JSON report here, then summarise the six answers above it. -->

_Awaiting first run._

### Q1 — shadow roots present

_pending_

### Q2 — open or closed

_pending_ — **this is the gate.** If closed, stop and report; no bookmarklet or
extension can read closed shadow roots.

### Q3 — nesting depth

_pending_

### Q4 — pierced vs. plain walk

_pending_

### Q5 — heading signals

_pending_

### Q6 — virtualization

_pending_
