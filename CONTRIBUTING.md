# Contributing

## The one rule

**loopmark makes zero network requests.** Everything else is negotiable; that is
not. It is what makes the tool defensible to a security review, and it is
enforced by [`scripts/check-no-network.mjs`](scripts/check-no-network.mjs) in CI.

If a change needs a network call, it does not belong in loopmark. Please do not
propose loosening the check.

## Getting set up

```bash
npm install
npm run verify   # typecheck, lint, test, build, and both security gates
```

Run `npm run verify` before opening a pull request. It is exactly what CI runs.

## Where things live

| File | Responsibility |
| --- | --- |
| `src/selectors.ts` | **All** Loop-specific DOM knowledge. Nothing else. |
| `src/acquire.ts` | Composed-tree traversal, content-root discovery, expansion, scrolling. |
| `src/convert.ts` | DOM → IR → GitHub-flavored Markdown. |
| `src/ui.ts` | The overlay. |
| `src/main.ts` | Orchestration and the host guard. Deliberately tiny. |
| `spikes/probe.js` | The feasibility probe. Re-run it whenever Loop changes. |

### If loopmark stopped working

It is almost certainly a selector change, and almost certainly a one-file fix.

1. Open a Loop page, paste `spikes/probe.js` into the DevTools console.
2. Read the report, particularly `contentRootCandidates` and `inventory`.
3. Add a candidate to the relevant list in `src/selectors.ts`. Candidates are
   tried in order, so put the specific one above the generic fallbacks.
4. Add a synthetic fixture and a test reproducing the shape you found.

Do not add Loop-specific selectors anywhere except `src/selectors.ts`. If you
find yourself wanting to, that is a sign `selectors.ts` needs a new exported
pattern rather than that the rule needs bending.

### Commenting selectors

Every entry carries what it targets and one of:

- `VERIFIED <date> <how>` — confirmed against live markup or the probe.
- `UNVERIFIED` — a structural guess.

Downgrade an entry to `UNVERIFIED` rather than deleting it if you are unsure; a
stale candidate that never matches costs almost nothing, and a deleted one loses
the knowledge.

## Fixtures

Fixtures in `test/fixtures/` must be **synthetic**. This is a public repository.

- No real company domains, tenant IDs, GUIDs, or email addresses.
- No real people's names — use `Person A`, `Reviewer B`.
- No internal project, service, or system names.
- URLs use `example.invalid` / `example.com` only.

`scripts/check-fixtures.mjs` enforces this in CI. If you are adding a fixture
after debugging a real page, **retype it by hand from the shape of the markup**.
Do not paste and redact — redaction misses things.

## Tests

The converter is tested through the IR, so a change usually needs two assertions:
one that the right IR came out of the DOM, and one that the right Markdown came
out of the IR.

Two tests are load-bearing and should never be weakened:

- Headings must never render as `- ` bullets. This is the artifact the project
  exists to fix.
- The output must never contain a run of three or more asterisks — that is the
  signature of double-wrapping inherited `font-weight`.

## Scope

loopmark is deliberately small. These are out of scope:

- Writing back to Loop, in any form.
- Network calls of any kind, including image downloading.
- Bulk or workspace export. One page, the one on screen.
- Authentication handling.
- Being a Loop API replacement. It is a DOM scraper and says so.

## Commits and pull requests

Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
Explain *why* in the body, not just *what* — for selector changes especially,
record what you observed in the live markup, because the next person to touch it
will not be able to see what you saw.

Rebuild and commit `dist/` when source changes. CI fails if it is stale.
