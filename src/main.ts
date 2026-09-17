/**
 * loopmark entry point.
 *
 * Orchestration only -- every interesting decision lives in acquire.ts,
 * convert.ts, selectors.ts or ui.ts. Kept deliberately small so that a
 * security reviewer can read the whole control flow in one screen.
 */

import {
  countShadowRoots,
  expandCollapsed,
  findContentRoot,
  findTitle,
  forceRender,
  walkComposed,
  type WalkStats,
} from './acquire.js';
import { convert } from './convert.js';
import { isLoopHost, LOOP_HOSTS, PREPARE_PASSES } from './selectors.js';
import type { Diagnostics } from './types.js';
import { copyText, removeExistingOverlay, showMessage, showOverlay } from './ui.js';

async function run(): Promise<void> {
  showMessage({
    heading: 'loopmark',
    message: 'Reading the page… scrolling to make Loop render everything.',
    busy: true,
  });

  const diagnostics: Diagnostics = {
    contentRootStrategy: 'unknown',
    shadowRootsPierced: 0,
    unrecognizedElements: 0,
    unrecognizedSamples: [],
    expandedWidgets: 0,
    elementsVisited: 0,
    droppedDataImages: 0,
    collapsedSections: [],
    warnings: [],
  };

  // 1. Locate the content. Done before expansion so that expansion is scoped
  //    to the document rather than the whole app shell.
  let { root, strategy, rejected } = findContentRoot(document);
  diagnostics.contentRootStrategy = strategy;
  if (strategy === 'fallback-body') {
    diagnostics.warnings.push(
      'Could not identify the Loop page content container, so the whole page was ' +
        'exported. Output will contain navigation and UI text. See src/selectors.ts.',
    );
  }

  // 2. Make sure everything is actually in the DOM.
  //
  //    Expansion and scrolling feed each other: scrolling renders blocks that
  //    were virtualized, and those blocks bring their own collapsed widgets
  //    ("Show more lines" inside a code block, collapsed headings). A single
  //    expand-then-scroll pass therefore misses anything below the fold, which
  //    is how three of four code blocks went missing. Repeat until a pass
  //    finds nothing left to open.
  diagnostics.expandedWidgets = await expandCollapsed(root);
  let scrolled = await forceRender(root, document);

  for (let pass = 1; pass < PREPARE_PASSES; pass += 1) {
    const opened = await expandCollapsed(root);
    if (opened === 0) break;
    diagnostics.expandedWidgets += opened;
    scrolled = (await forceRender(root, document)) || scrolled;
  }

  if (!scrolled) {
    diagnostics.warnings.push(
      'No scrollable container was found, so virtualized content could not be forced ' +
        'to render. If the page is long, the export may be truncated.',
    );
  }

  // Expanding and scrolling can replace the content container wholesale in a
  // virtualized tree, so re-resolve it rather than holding a stale reference.
  if (!root.isConnected) {
    ({ root, strategy, rejected } = findContentRoot(document));
    diagnostics.contentRootStrategy = `${strategy} (re-resolved)`;
  }

  // 3. Measure what we are about to walk, for the truncation detector.
  const stats: WalkStats = { elementsVisited: 0, shadowRootsPierced: 0 };
  walkComposed(root, () => undefined, stats);
  diagnostics.elementsVisited = stats.elementsVisited;
  diagnostics.shadowRootsPierced = stats.shadowRootsPierced;

  if (stats.shadowRootsPierced === 0 && countShadowRoots(document.body) === 0) {
    diagnostics.warnings.push(
      'No open shadow roots were found anywhere on the page. If content is missing, ' +
        'Loop may have switched to closed shadow roots, which no bookmarklet can read.',
    );
  }

  // 4. Convert.
  const title = findTitle(document);
  const result = convert({
    root,
    meta: { title, url: location.href, exportedAt: new Date().toISOString() },
    diagnostics,
  });

  if (result.markdown.trim().length < 80) {
    diagnostics.warnings.push(
      `Almost nothing was extracted. Content-root candidates tried: ${rejected.join('; ') || 'none'}.`,
    );
  }

  // 5. Copy first, then show. The overlay reports which path succeeded rather
  //    than copying silently.
  const autoCopy = await copyText(result.markdown);

  showOverlay({ markdown: result.markdown, title, diagnostics, autoCopy });
}

function main(): void {
  try {
    if (!isLoopHost(location.host)) {
      showMessage({
        heading: 'This does not look like a Loop page',
        message:
          `loopmark expects to run on ${LOOP_HOSTS.join(' or ')}. You are on ` +
          `${location.host}. You can try anyway -- it reads the DOM either way and ` +
          `changes nothing -- but the selectors are tuned for Loop.`,
        action: { label: 'Export anyway', onClick: () => void guard(run) },
      });
      return;
    }
    void guard(run);
  } catch (error) {
    reportFailure(error);
  }
}

async function guard(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    reportFailure(error);
  }
}

function reportFailure(error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n\n${error.stack ?? ''}` : String(error);
  showMessage({
    heading: 'loopmark hit an error',
    message:
      'Nothing on the page was changed. This is almost always a Loop UI change that ' +
      'broke a selector -- see src/selectors.ts, and re-run spikes/probe.js to find ' +
      'the new markup.',
    detail,
  });
}

removeExistingOverlay();
main();
