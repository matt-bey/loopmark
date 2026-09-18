/**
 * Entry point for offline conversion of a saved page (`npm run try`).
 *
 * Deliberately separate from `main.ts`: this one does no clipboard work, no
 * scrolling, no overlay and no host check -- it is the pure DOM -> Markdown
 * path, so that the command-line feedback loop exercises exactly the code the
 * bookmarklet uses for conversion and nothing else.
 */

import { findContentRoot, findTitle } from './acquire.js';
import { captureComments } from './comments.js';
import { convertElement, emptyDiagnostics } from './convert.js';
import type { ConversionResult } from './types.js';

export function convertDocument(doc: Document): ConversionResult {
  const { root, strategy } = findContentRoot(doc);

  // Anchoring compares layout positions, and a saved page opened in jsdom has
  // no layout at all -- so offline every thread falls back to the unanchored
  // "## Comments" section. That is the same code path a real browser takes
  // when Loop's geometry is unreadable, which is what makes it worth testing.
  const comments = captureComments(root, doc, emptyDiagnostics());

  const result = convertElement(
    root,
    { title: findTitle(doc), url: doc.location?.href ?? '' },
    comments,
  );
  result.diagnostics.contentRootStrategy = strategy;
  return result;
}
