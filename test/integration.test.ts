/**
 * End-to-end test of the SHIPPED artifact.
 *
 * Every other test imports TypeScript modules directly. This one evaluates
 * `dist/loopmark.bundle.js` -- the actual bundled, tree-shaken output that
 * users run -- against a synthetic Loop page, and drives the resulting UI.
 * That covers bundling, module ordering, and main.ts's top-level side effect,
 * none of which the unit tests touch.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BUNDLE = readFileSync(resolve(process.cwd(), 'dist/loopmark.bundle.js'), 'utf8');

/** Markup shaped like a real Loop page, in Scriptor's idiom. */
const LOOP_PAGE = `
  <div role="main">
    <div class="scriptor-pageContainer">
      <div class="scriptor-pageHeader"><span>Presence avatars and cover art</span></div>
      <div class="scriptor-pageTitle">Architecture Review</div>

      <div class="scriptor-collapsibleHeading" role="heading" aria-level="2">Background</div>
      <div class="scriptor-paragraph">
        <div class="scriptor-line">We need a decision on the caching layer.</div>
      </div>
      <div class="scriptor-paragraph">
        See
        <span class="scriptor-hyperlink" role="link"
              title="https://example.invalid/spec&#10;Click to follow link">the spec</span>
        for context.
      </div>

      <ul>
        <li role="heading" aria-level="3">Options</li>
        <li><div class="scriptor-paragraph">Option A, cheap and risky</div></li>
        <li><div class="scriptor-paragraph">Option B, costly and safe</div></li>
      </ul>

      <table>
        <thead><tr><th>Option</th><th>Cost</th></tr></thead>
        <tbody>
          <tr><td>A</td><td>Low</td></tr>
          <tr><td>B</td><td>High</td></tr>
        </tbody>
      </table>

      <div class="scriptor-task"><input type="checkbox" checked>
        <div class="scriptor-paragraph">Draft the options</div></div>
      <div class="scriptor-task"><input type="checkbox">
        <div class="scriptor-paragraph">Circulate for review</div></div>
    </div>
  </div>`;

const overlay = (): Element | null => document.querySelector('loopmark-overlay');
const shadow = (): ShadowRoot => overlay()!.shadowRoot!;
const button = (text: string): HTMLButtonElement | undefined =>
  Array.from(shadow().querySelectorAll('button')).find((b) => b.textContent === text);

/** Execute the shipped bundle in this jsdom realm, as a browser would. */
function runBundle(): void {
  new Function(BUNDLE)();
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.querySelectorAll('loopmark-overlay').forEach((n) => n.remove());
});

describe('shipped bundle', () => {
  it('guards on a non-Loop host instead of running blind', () => {
    document.body.innerHTML = LOOP_PAGE;
    runBundle();

    // vitest's jsdom URL is localhost, so the host guard must fire.
    expect(shadow().querySelector('h1')!.textContent).toContain('does not look like a Loop page');
    expect(button('Export anyway')).toBeDefined();
    // It must not have exported anything yet.
    expect(shadow().querySelector('textarea')).toBeNull();
  });

  it('exports structurally correct Markdown through the real pipeline', async () => {
    document.body.innerHTML = LOOP_PAGE;
    runBundle();
    button('Export anyway')!.click();

    await vi.waitFor(() => expect(shadow().querySelector('textarea')).not.toBeNull(), {
      timeout: 15_000,
    });

    const md = shadow().querySelector('textarea')!.value;

    // Title came from .scriptor-pageTitle, and is not duplicated in the body.
    expect(md.startsWith('# Architecture Review\n')).toBe(true);
    expect(md.match(/Architecture Review/g)!.length).toBe(2); // title + provenance

    expect(md).toContain('## Background');
    expect(md).toContain('We need a decision on the caching layer.');
    expect(md).toContain('[the spec](https://example.invalid/spec)');

    // The regression that matters most: a heading inside a list item is
    // promoted out of the list, never rendered as "- ### Options".
    expect(md).toContain('### Options');
    expect(md).not.toMatch(/^\s*[-*+]\s+#/m);
    expect(md).toContain('- Option A, cheap and risky');

    expect(md).toContain('| Option | Cost |\n| --- | --- |\n| A | Low |\n| B | High |');
    expect(md).toContain('- [x] Draft the options\n- [ ] Circulate for review');

    // Page chrome is excluded.
    expect(md).not.toContain('Presence avatars');

    // Provenance block survives as an HTML comment.
    expect(md).toContain('<!-- Exported from Microsoft Loop by loopmark on');
  }, 20_000);

  it('reports diagnostics that make a bug report actionable', async () => {
    document.body.innerHTML = LOOP_PAGE;
    runBundle();
    button('Export anyway')!.click();
    await vi.waitFor(() => expect(shadow().querySelector('details pre')).not.toBeNull(), {
      timeout: 15_000,
    });

    const details = shadow().querySelector('details pre')!.textContent!;
    expect(details).toContain('content root strategy : scriptor-page-container');
    expect(details).toMatch(/elements visited\s+: \d+/);
  }, 20_000);

  it('closes on Escape and leaves the page as it found it', async () => {
    document.body.innerHTML = LOOP_PAGE;
    const before = document.body.innerHTML;

    runBundle();
    button('Export anyway')!.click();
    await vi.waitFor(() => expect(shadow().querySelector('textarea')).not.toBeNull(), {
      timeout: 15_000,
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay()).toBeNull();

    // The Loop document itself is untouched -- loopmark is read-only.
    expect(document.body.innerHTML).toBe(before);
  }, 20_000);
});
