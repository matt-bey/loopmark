/**
 * DOM acquisition: find the content, make sure all of it is actually rendered,
 * and provide a traversal primitive that sees through open shadow roots.
 *
 * Nothing in this file is Loop-specific -- every selector it uses comes from
 * `selectors.ts`.
 */

import {
  CONTENT_ROOT_CANDIDATES,
  MIN_PARAGRAPHS_FOR_ROOT,
  PARAGRAPH_SELECTOR,
  DANGEROUS_CLICK_PATTERNS,
  EXPANDABLE_ALLOWLIST,
  FORCE_RENDER,
  MAX_EXPAND_CLICKS,
  MIN_CONTENT_ROOT_CHARS,
  TITLE_CANDIDATES,
} from './selectors.js';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isElement = (node: Node): node is Element => node.nodeType === 1;

const isSlot = (node: Node): node is HTMLSlotElement =>
  isElement(node) && node.tagName === 'SLOT';

// ---------------------------------------------------------------------------
// Composed-tree traversal
// ---------------------------------------------------------------------------

/**
 * The children of `node` as they are actually *rendered*.
 *
 * Three cases matter:
 *   1. Element with an open shadow root -> its light children are NOT rendered
 *      directly; the shadow tree is. Descend into the shadow root instead, or
 *      the slotted content gets visited twice and in the wrong order.
 *   2. A `<slot>` -> stands in for its assigned nodes. `{ flatten: true }`
 *      resolves slot-to-slot forwarding in nested components.
 *   3. Everything else -> ordinary child nodes.
 *
 * A `<slot>` with no assigned nodes renders its fallback content, which is
 * exactly its ordinary children, so case 2 falls through to case 3.
 */
export function composedChildren(node: Node): Node[] {
  if (isElement(node)) {
    const shadow = (node as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (shadow) return Array.from(shadow.childNodes);
    if (isSlot(node)) {
      const assigned = node.assignedNodes({ flatten: true });
      if (assigned.length > 0) return assigned;
    }
  }
  return Array.from(node.childNodes);
}

export interface WalkStats {
  elementsVisited: number;
  shadowRootsPierced: number;
}

/**
 * Depth-first walk of the composed tree rooted at `root`.
 *
 * `visit` returning `false` prunes the subtree -- used to skip excluded chrome
 * without paying to traverse it.
 */
export function walkComposed(
  root: Node,
  visit: (node: Node) => boolean | void,
  stats?: WalkStats,
): void {
  const seen = new Set<Node>();

  const step = (node: Node): void => {
    // Cycles are impossible in a well-formed tree, but slot reassignment during
    // traversal of a live editor is not something to bet the main thread on.
    if (seen.has(node)) return;
    seen.add(node);

    if (stats && isElement(node)) {
      stats.elementsVisited += 1;
      if ((node as Element & { shadowRoot: ShadowRoot | null }).shadowRoot) {
        stats.shadowRootsPierced += 1;
      }
    }

    if (visit(node) === false) return;
    for (const child of composedChildren(node)) step(child);
  };

  step(root);
}

/**
 * `querySelectorAll` that descends into open shadow roots.
 *
 * Results are in composed-tree document order and deduplicated.
 */
export function pierceQuerySelectorAll(root: Node, selector: string): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  walkComposed(root, (node) => {
    if (!isElement(node) || seen.has(node)) return;
    let matched = false;
    try {
      matched = node.matches(selector);
    } catch {
      // An invalid selector should disable that one candidate, not the tool.
      return false;
    }
    if (matched) {
      seen.add(node);
      out.push(node);
    }
  });
  return out;
}

/** First composed-tree match for `selector`, or `null`. */
export function pierceQuerySelector(root: Node, selector: string): Element | null {
  return pierceQuerySelectorAll(root, selector)[0] ?? null;
}

/**
 * `getElementById` that descends into open shadow roots.
 *
 * Needed for `aria-owns`, which references items by ID that may live in a
 * different shadow tree than the list that owns them.
 */
export function pierceGetElementById(root: Node, id: string): Element | null {
  if (!id) return null;
  // Escape for use inside an attribute selector; CSS.escape is not available
  // in every context a bookmarklet lands in.
  const escaped = id.replace(/["\\]/g, '\\$&');
  return pierceQuerySelector(root, `[id="${escaped}"]`);
}

/** Visible text of `node` including text inside open shadow roots. */
export function composedText(node: Node): string {
  let out = '';
  walkComposed(node, (n) => {
    if (n.nodeType === 3) out += n.nodeValue ?? '';
  });
  return out;
}

/** Count of open shadow roots anywhere beneath `root`. */
export function countShadowRoots(root: Node): number {
  const stats: WalkStats = { elementsVisited: 0, shadowRootsPierced: 0 };
  walkComposed(root, () => undefined, stats);
  return stats.shadowRootsPierced;
}

// ---------------------------------------------------------------------------
// Content root discovery
// ---------------------------------------------------------------------------

export interface ContentRootResult {
  root: Element;
  /** Name of the candidate strategy that matched, for diagnostics. */
  strategy: string;
  /** Candidate names that were tried and rejected, with why. */
  rejected: string[];
}

/**
 * Locate the page content container.
 *
 * Expect this to be the most brittle function in the codebase, which is why it
 * is a list rather than a selector: candidates are tried in order, each must
 * clear a minimum-content threshold, and the winner is recorded so a user can
 * report "it matched aria-main" without opening devtools.
 */
export function findContentRoot(doc: Document = document): ContentRootResult {
  const rejected: string[] = [];

  for (const candidate of CONTENT_ROOT_CANDIDATES) {
    const matches = pierceQuerySelectorAll(doc, candidate.selector);
    if (matches.length === 0) {
      rejected.push(`${candidate.name}: no match`);
      continue;
    }

    // Several elements can match (nested contenteditables, for example).
    // Take the one carrying the most text -- that is the document body, not a
    // single-line title field.
    let best: Element | null = null;
    let bestLen = -1;
    for (const el of matches) {
      const len = composedText(el).trim().length;
      if (len > bestLen) {
        bestLen = len;
        best = el;
      }
    }

    if (!best || bestLen < MIN_CONTENT_ROOT_CHARS) {
      rejected.push(`${candidate.name}: matched ${matches.length} but only ${bestLen} chars`);
      continue;
    }

    return { root: best, strategy: candidate.name, rejected };
  }

  // Last-ditch: climb from the first paragraph block to the nearest ancestor
  // holding several of them. This survives a wholesale rename of the page
  // container as long as the paragraph class itself holds.
  const paragraphs = pierceQuerySelectorAll(doc, PARAGRAPH_SELECTOR);
  if (paragraphs.length >= MIN_PARAGRAPHS_FOR_ROOT && paragraphs[0]) {
    let parent = composedParent(paragraphs[0]);
    while (parent && parent !== doc.body) {
      if (pierceQuerySelectorAll(parent, PARAGRAPH_SELECTOR).length >= MIN_PARAGRAPHS_FOR_ROOT) {
        return { root: parent, strategy: 'paragraph-ancestor', rejected };
      }
      parent = composedParent(parent);
    }
  }
  rejected.push(`paragraph-ancestor: found ${paragraphs.length} paragraph blocks`);

  // Nothing matched. `body` always "works" and always produces noisy output,
  // which is the correct failure mode: degraded, not blank.
  rejected.push('all candidates exhausted');
  return { root: doc.body, strategy: 'fallback-body', rejected };
}

/**
 * The parent of `el` in the composed tree.
 *
 * `parentElement` is null at the top of a shadow tree; the shadow host is the
 * real rendered parent, so step across the boundary.
 */
export function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Best-effort page title, falling back to `document.title`. */
export function findTitle(doc: Document = document): string {
  for (const selector of TITLE_CANDIDATES) {
    const el = pierceQuerySelector(doc, selector);
    if (!el) continue;
    const text = composedText(el).replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  // Loop appends app chrome to document.title; strip the trailing segment.
  return (doc.title || 'Untitled').replace(/\s*[|–—-]\s*(Microsoft )?Loop\s*$/i, '').trim()
    || 'Untitled';
}

// ---------------------------------------------------------------------------
// Disclosure expansion
// ---------------------------------------------------------------------------

/** Text we can use to decide whether an element is safe to click. */
function clickableLabel(el: Element): string {
  const parts = [
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('title') ?? '',
    el.getAttribute('data-testid') ?? '',
    typeof el.className === 'string' ? el.className : '',
    (el.textContent ?? '').slice(0, 120),
  ];
  return parts.join(' ');
}

/** Hard veto: never click anything whose label smells like a real action. */
export function isSafeToClick(el: Element): boolean {
  const label = clickableLabel(el);
  return !DANGEROUS_CLICK_PATTERNS.some((pattern) => pattern.test(label));
}

/**
 * Expand collapsed sections so their content is in the DOM to be read.
 *
 * Safety model: an element is clicked only if it matches the narrow allowlist
 * in `selectors.ts` AND survives the `DANGEROUS_CLICK_PATTERNS` veto AND has
 * not been clicked already. Expanding can reveal further collapsed sections,
 * so we run a few passes -- but never more than `MAX_EXPAND_CLICKS` total.
 *
 * Idempotent: `aria-expanded` flips to `"true"` on success, so a second run
 * finds nothing to do.
 */
export async function expandCollapsed(root: Node): Promise<number> {
  const clicked = new Set<Element>();
  const deadline = Date.now() + FORCE_RENDER.budgetMs;

  for (let pass = 0; pass < 4; pass += 1) {
    if (Date.now() > deadline || clicked.size >= MAX_EXPAND_CLICKS) break;

    const targets: Element[] = [];
    for (const selector of EXPANDABLE_ALLOWLIST) {
      for (const el of pierceQuerySelectorAll(root, selector)) {
        if (!clicked.has(el) && isSafeToClick(el)) targets.push(el);
      }
    }
    if (targets.length === 0) break;

    for (const el of targets) {
      if (clicked.size >= MAX_EXPAND_CLICKS) break;
      clicked.add(el);
      try {
        (el as HTMLElement).click();
      } catch {
        // A detached or disabled node is not worth failing the export over.
      }
    }
    await sleep(FORCE_RENDER.settleMs);
  }

  return clicked.size;
}

// ---------------------------------------------------------------------------
// Virtualization defeat
// ---------------------------------------------------------------------------

/**
 * The element that actually scrolls the document.
 *
 * Loop scrolls an inner container rather than the window, so
 * `window.scrollTo` does nothing useful. We pick the descendant with the
 * largest vertical overflow that is also styled to scroll.
 */
export function findScroller(root: Node, doc: Document = document): Element | null {
  let best: Element | null = doc.scrollingElement;
  let bestOverflow = best ? best.scrollHeight - best.clientHeight : 0;

  walkComposed(root, (node) => {
    if (!isElement(node)) return;
    const overflow = node.scrollHeight - node.clientHeight;
    if (overflow <= bestOverflow) return;
    let overflowY = '';
    try {
      overflowY = getComputedStyle(node).overflowY;
    } catch {
      return;
    }
    if (!/auto|scroll/.test(overflowY)) return;
    best = node;
    bestOverflow = overflow;
  });

  return bestOverflow > 0 ? best : null;
}

/**
 * Scroll through the content to force virtualized rows to mount, then restore
 * the user's original scroll position.
 *
 * This is the one place loopmark changes what the user sees, and it puts it
 * back. Bounded by `FORCE_RENDER.budgetMs` so a very long page degrades to
 * partial content rather than a hung tab.
 */
export async function forceRender(root: Node, doc: Document = document): Promise<boolean> {
  const scroller = findScroller(root, doc);
  if (!scroller) return false;

  const original = scroller.scrollTop;
  const deadline = Date.now() + FORCE_RENDER.budgetMs;

  for (let i = 1; i <= FORCE_RENDER.steps; i += 1) {
    if (Date.now() > deadline) break;
    scroller.scrollTop = (scroller.scrollHeight * i) / FORCE_RENDER.steps;
    await sleep(FORCE_RENDER.settleMs);
  }

  if (Date.now() <= deadline) {
    scroller.scrollTop = scroller.scrollHeight;
    await sleep(FORCE_RENDER.bottomSettleMs);
  }

  scroller.scrollTop = original;
  await sleep(FORCE_RENDER.settleMs);
  return true;
}
