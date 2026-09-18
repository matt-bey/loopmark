/**
 * Convert a saved Loop page to Markdown, offline.
 *
 *   npm run try -- "~/Downloads/My Page.html"          # print to stdout
 *   npm run try -- "~/Downloads/My Page.html" out.md   # write to a file
 *
 * This is the development feedback loop for anyone without a browser to test
 * in. Save a Loop page with "Save page as… → Web page, complete", point this
 * at the `.html`, and compare the output against what you see in Loop.
 *
 * Two caveats, both consequences of a static snapshot:
 *
 *   - `forceRender()` does not run, so anything Loop had virtualized when you
 *     saved is simply absent. Scroll the whole page before saving.
 *   - jsdom applies no external stylesheets, so emphasis that Loop expresses
 *     through a CSS class rather than a tag will not be detected. The real
 *     bookmarklet reads `getComputedStyle` in a real browser and does better.
 *
 * The diagnostics printed to stderr say which of these bit.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const expand = (p) => resolve(p.startsWith('~') ? p.replace(/^~/, homedir()) : p);

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('usage: npm run try -- <saved-loop-page.html> [output.md]');
  process.exit(2);
}

// Bundle the TypeScript sources for Node, so this script needs no extra
// tooling beyond the esbuild the build already depends on.
const bundled = await build({
  entryPoints: ['src/offline.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
});
const source = bundled.outputFiles[0].text;

const dom = new JSDOM(readFileSync(expand(input), 'utf8'), {
  url: 'https://loop.cloud.microsoft/p/offline',
});

// The converter reads these as globals, exactly as it does in a browser.
for (const name of [
  'document', 'Node', 'Element', 'HTMLElement', 'ShadowRoot', 'HTMLSlotElement',
]) {
  globalThis[name] = name === 'document' ? dom.window.document : dom.window[name];
}
globalThis.window = dom.window;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { convertDocument } = await import(dataUrl);
const result = convertDocument(dom.window.document);

if (output) {
  writeFileSync(expand(output), result.markdown);
  console.error(`wrote ${expand(output)}`);
} else {
  process.stdout.write(result.markdown);
}

const d = result.diagnostics;
console.error('');
console.error(`  content root  : ${d.contentRootStrategy}`);
console.error(`  markdown      : ${result.markdown.length} chars, ${result.markdown.split('\n').length} lines`);
console.error(`  tables        : ${(result.markdown.match(/^\| --- /gm) ?? []).length}`);
console.error(`  data: images  : ${d.droppedDataImages} replaced with a placeholder`);
console.error(
  `  comments      : ${d.commentThreads} thread(s)` +
    (d.commentThreads > 0 ? `, ${d.commentsAnchored} anchored` : ''),
);
console.error(`  unrecognized  : ${d.unrecognizedElements}${d.unrecognizedSamples.length ? ` (${d.unrecognizedSamples.join(', ')})` : ''}`);
for (const warning of d.warnings) console.error(`  warning       : ${warning}`);
