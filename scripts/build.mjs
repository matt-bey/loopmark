#!/usr/bin/env node
/**
 * Build the bookmarklet.
 *
 *   src/main.ts  --esbuild-->  single IIFE  --encode-->  javascript: URL
 *
 * Produces:
 *   dist/loopmark.bookmarklet.txt  the thing you put on your bookmarks bar
 *   dist/loopmark.bundle.js        the same code, unminified, for auditing
 *   dist/install.html              a local page with a draggable link
 *
 * No externals, no sourcemap in the shipped blob, no network access at build
 * time beyond whatever npm already installed.
 */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

/**
 * Browsers disagree on bookmark URL length, so this is a guardrail rather than
 * a hard limit anyone has hit. Chrome and Edge -- the two browsers loopmark
 * supports -- store bookmarklets far larger than this; the cap exists to make
 * accidental bloat visible in CI, not because 96 KB is a cliff. Raised from
 * 60 KB on 2026-09-16, when handling Loop's real markup pushed the payload to
 * 90% of the old figure and the old figure turned out to be arbitrary.
 */
const MAX_ENCODED_BYTES = 96 * 1024;

/** Where this page points people when they want to read the code. */
const REPO_URL = 'https://github.com/matt-bey/loopmark';

/**
 * A deterministic identity for the source this bundle was built from.
 *
 * Stamped into the bundle so a running bookmarklet can say which build it is:
 * a bookmarklet is never updated after it is dragged, so an export that looks
 * wrong needs to name the code that produced it.
 *
 * NOT a timestamp. `dist/` is committed and CI asserts that a rebuild produces
 * no diff, so anything that varies between builds of identical source breaks
 * that check the day after it is committed -- which the build date silently
 * did. Hashing the sources instead means the same code always yields the same
 * bytes, and anyone can recompute this from a checkout to see which commit an
 * installed bookmarklet came from.
 */
function sourceId() {
  const dir = resolve(ROOT, 'src');
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(readFileSync(resolve(dir, file)));
  }
  return hash.digest('hex').slice(0, 12);
}

const BUILD_STAMP = sourceId();

const SHARED = {
  entryPoints: [resolve(ROOT, 'src/main.ts')],
  define: { __LOOPMARK_BUILD__: JSON.stringify(BUILD_STAMP) },
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  write: false,
  legalComments: 'none',
  // No externals: anything not in this repo would be a runtime dependency,
  // and a runtime dependency is a thing that could make a network request.
  external: [],
};

async function bundleOnce(minify) {
  const result = await build({ ...SHARED, minify, sourcemap: false });
  const file = result.outputFiles?.[0];
  if (!file) throw new Error('esbuild produced no output');
  return file.text;
}

function toBookmarkletUrl(code) {
  // A `javascript:` URL that evaluates to anything other than undefined makes
  // the browser navigate to that value. `void 0` makes that unconditional
  // rather than a happy accident of esbuild's IIFE output.
  return `javascript:${encodeURIComponent(`${code};void 0;`)}`;
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function installHtml(url, stats) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Install loopmark</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         max-width: 760px; margin: 0 auto; padding: 48px 24px 96px; }
  h1 { font-size: 28px; letter-spacing: -.02em; margin: 0 0 6px; }
  .sub { color: #6b7280; margin: 0 0 32px; }
  .drag { display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
          padding: 24px; border: 2px dashed #c7ccd6; border-radius: 12px; margin: 0 0 32px; }
  a.bookmarklet { display: inline-block; padding: 10px 20px; border-radius: 8px;
                  background: #2f3b52; color: #fff; text-decoration: none; font-weight: 600;
                  cursor: grab; }
  a.bookmarklet:active { cursor: grabbing; }
  h2 { font-size: 18px; margin: 32px 0 8px; }
  ol, ul { padding-left: 22px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13.5px;
         background: rgba(127,127,127,.15); padding: 1px 5px; border-radius: 4px; }
  textarea { width: 100%; height: 130px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
             font-size: 11px; padding: 10px; border-radius: 8px; border: 1px solid #c7ccd6; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid rgba(127,127,127,.25); }
  .note { border-left: 3px solid #d0a13a; padding: 10px 14px; background: rgba(208,161,58,.1);
          border-radius: 0 8px 8px 0; font-size: 14.5px; }
</style>
</head>
<body>

<h1>loopmark</h1>
<p class="sub">Convert the Microsoft Loop page you are looking at into clean Markdown.
   Makes zero network requests.<br>
   <a href="${REPO_URL}">Source, documentation and issues on GitHub</a></p>

<div class="drag">
  <a class="bookmarklet" href="${escapeHtml(url)}">loopmark</a>
  <span><strong>Drag this to your bookmarks bar.</strong><br>
  Clicking it here will not do anything useful &mdash; it only works on a Loop page.</span>
</div>

<h2>Install</h2>
<ol>
  <li>Make the bookmarks bar visible: <code>Cmd/Ctrl</code> + <code>Shift</code> + <code>B</code>.</li>
  <li>Drag the <strong>loopmark</strong> button above onto it.</li>
  <li>Open a Loop page and click the bookmark.</li>
</ol>
<p>If dragging does not work, create a new bookmark by hand and paste the URL below
   into its address field.</p>
<textarea readonly onclick="this.select()">${escapeHtml(url)}</textarea>

<h2>What happens when you click it</h2>
<ol>
  <li>Scrolls the page to force virtualized content to render, then scrolls back.</li>
  <li>Reads the rendered DOM, including open shadow roots.</li>
  <li>Converts it to GitHub-flavored Markdown.</li>
  <li>Copies it to your clipboard and shows it in an overlay. <code>Esc</code> closes the overlay.</li>
</ol>

<h2>Browser support</h2>
<table>
  <tr><th>Browser</th><th>Status</th></tr>
  <tr><td>Chrome</td><td>Supported</td></tr>
  <tr><td>Edge</td><td>Supported</td></tr>
  <tr><td>Firefox</td><td>Untested</td></tr>
  <tr><td>Safari</td><td>Known to block bookmarklets on Loop pages</td></tr>
</table>

<p class="note"><strong>Read-only.</strong> loopmark never writes to your Loop document.
  It scrolls the page and scrolls back, and that is all it touches: it will not even expand a
  collapsed section, because Loop syncs that state to everyone else on the document. Collapsed
  sections are named in the output instead, so you can open the ones you want and export again.
  It makes no network requests of any kind &mdash; nothing it reads can leave your browser.</p>

<h2>Build provenance</h2>
<ul>
  <li>Bookmarklet size: <code>${stats.encodedKb} KB</code> encoded (limit ${(MAX_ENCODED_BYTES / 1024).toFixed(0)} KB)</li>
  <li>Minified bundle: <code>${stats.minifiedKb} KB</code></li>
  <li>Source ID: <code>${stats.builtAt}</code></li>
  <li>SHA-256 of the bookmarklet: <code>${stats.sha256}</code></li>
</ul>
<p>Rebuild from source with <code>npm run build</code> and diff this file to verify
   the bookmarklet matches the code you reviewed. If you are reading this on a
   hosted page rather than your own machine, check the hash above against
   <a href="${REPO_URL}/blob/main/dist/CHECKSUMS.txt">dist/CHECKSUMS.txt</a> in the
   repository &mdash; that is what makes a hosted install auditable rather than
   something you simply trust.</p>
<p>The Source ID is a digest of <a href="${REPO_URL}/tree/main/src">src/</a>, reproducible
   from any checkout, and it is shown in the overlay's Details pane &mdash; so an export
   that looks wrong can always be traced to the code that produced it.</p>

</body>
</html>
`;
}

const minified = await bundleOnce(true);
const readable = await bundleOnce(false);
const url = toBookmarkletUrl(minified);

const encodedBytes = Buffer.byteLength(url, 'utf8');
const stats = {
  encodedKb: (encodedBytes / 1024).toFixed(1),
  minifiedKb: (Buffer.byteLength(minified, 'utf8') / 1024).toFixed(1),
  builtAt: BUILD_STAMP,
  sha256: createHash('sha256').update(url, 'utf8').digest('hex'),
};

mkdirSync(DIST, { recursive: true });
writeFileSync(resolve(DIST, 'loopmark.bookmarklet.txt'), url, 'utf8');
writeFileSync(resolve(DIST, 'loopmark.bundle.js'), readable, 'utf8');
writeFileSync(resolve(DIST, 'install.html'), installHtml(url, stats), 'utf8');
// The hash of exactly what a user drags, so a hosted copy can be verified
// against the repository rather than taken on trust.
writeFileSync(
  resolve(DIST, 'CHECKSUMS.txt'),
  `# loopmark source ${stats.builtAt}\n` +
    `# sha256 of dist/loopmark.bookmarklet.txt, which is the javascript: URL itself.\n` +
    `# Verify with:  shasum -a 256 dist/loopmark.bookmarklet.txt\n` +
    `${stats.sha256}  loopmark.bookmarklet.txt\n`,
  'utf8',
);

const pct = ((encodedBytes / MAX_ENCODED_BYTES) * 100).toFixed(0);
console.log(`loopmark build
  minified bundle : ${stats.minifiedKb} KB
  bookmarklet URL : ${stats.encodedKb} KB encoded (${pct}% of the ${(MAX_ENCODED_BYTES / 1024).toFixed(0)} KB budget)
  output          : dist/loopmark.bookmarklet.txt, dist/loopmark.bundle.js, dist/install.html`);

if (encodedBytes > MAX_ENCODED_BYTES) {
  console.error(
    `\nFAIL: bookmarklet is ${stats.encodedKb} KB encoded, over the ` +
      `${(MAX_ENCODED_BYTES / 1024).toFixed(0)} KB budget. Browsers vary in how long a ` +
      `bookmark URL they accept; shrink the bundle rather than raising the limit.`,
  );
  process.exit(1);
}
