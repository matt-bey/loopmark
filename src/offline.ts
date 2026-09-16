/**
 * Entry point for offline conversion of a saved page (`npm run try`).
 *
 * Deliberately separate from `main.ts`: this one does no clipboard work, no
 * scrolling, no overlay and no host check -- it is the pure DOM -> Markdown
 * path, so that the command-line feedback loop exercises exactly the code the
 * bookmarklet uses for conversion and nothing else.
 */

import { findContentRoot, findTitle } from './acquire.js';
import { convertElement } from './convert.js';
import type { ConversionResult } from './types.js';

export function convertDocument(doc: Document): ConversionResult {
  const { root, strategy } = findContentRoot(doc);
  const result = convertElement(root, {
    title: findTitle(doc),
    url: doc.location?.href ?? '',
  });
  result.diagnostics.contentRootStrategy = strategy;
  return result;
}
