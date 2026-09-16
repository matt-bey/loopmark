import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { convertElement, resetMatchers } from '../src/convert.js';

// Under the jsdom environment `import.meta.url` resolves against the jsdom
// base URL (http://localhost/), not the filesystem -- hence cwd, which vitest
// sets to the project root.
const FIXTURE_DIR = resolve(process.cwd(), 'test/fixtures');

/** Parse a fixture file into a detached container element. */
export function fixture(name: string): HTMLElement {
  const html = readFileSync(resolve(FIXTURE_DIR, name), 'utf8');
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

/** Parse an HTML string into a detached container element. */
export function html(source: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = source;
  document.body.appendChild(host);
  return host;
}

/**
 * Convert and return only the body: the `# Title` line and the trailing
 * provenance comment are asserted separately, and would otherwise appear in
 * every expected string.
 */
export function body(el: HTMLElement): string {
  resetMatchers();
  const md = convertElement(el).markdown;
  return md
    .replace(/^# .*\n\n/, '')
    .replace(/\n*<!-- Exported from Microsoft Loop[\s\S]*$/, '')
    .trim();
}
