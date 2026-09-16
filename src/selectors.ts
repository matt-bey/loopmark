/**
 * ALL Loop-specific DOM knowledge lives in this file.
 *
 * When Microsoft ships a UI change and loopmark stops working, this should be
 * the only file that needs editing. Everything here is a guess about someone
 * else's unversioned, undocumented markup -- treat each entry as expiring.
 *
 * CONVENTION: every selector carries
 *   - what it targets
 *   - VERIFIED <date> if confirmed against a live page via spikes/probe.js
 *   - UNVERIFIED if it is a structural guess awaiting probe output
 */

// ---------------------------------------------------------------------------
// Host guard
// ---------------------------------------------------------------------------

/**
 * Hosts on which the bookmarklet will run without complaint.
 * Add tenant-specific hosts here; matching is exact or subdomain-suffix.
 */
export const LOOP_HOSTS: readonly string[] = [
  // The current Loop web app. VERIFIED 2026-09-16 (from the user's own URLs).
  'loop.cloud.microsoft',
];

/** True when `host` is, or is a subdomain of, a known Loop host. */
export function isLoopHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  return LOOP_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

// ---------------------------------------------------------------------------
// Content root discovery
// ---------------------------------------------------------------------------

/**
 * Ordered candidate selectors for the page content container.
 *
 * `findContentRoot` tries these in order and keeps the first that clears a
 * minimum-content threshold, so specific-and-fragile can safely sit above
 * generic-and-stable: if the specific one disappears, the generic one catches.
 *
 * To add a new candidate after a Loop UI change: add one entry. That's the
 * whole maintenance story.
 */
export const CONTENT_ROOT_CANDIDATES: readonly { name: string; selector: string }[] = [
  // Loop's canvas surface. UNVERIFIED -- fill in exact value from probe output.
  { name: 'loop-canvas-testid', selector: '[data-testid="canvas"]' },
  { name: 'loop-page-canvas', selector: '[class*="pageCanvas" i]' },
  { name: 'loop-canvas-class', selector: '[class*="canvas" i][contenteditable]' },

  // The Fluid editor surface. Loop pages are editable documents, so the
  // contenteditable region is the single most reliable structural signal.
  // UNVERIFIED but very likely.
  { name: 'main-contenteditable', selector: '[role="main"] [contenteditable="true"]' },
  { name: 'contenteditable-true', selector: '[contenteditable="true"]' },
  { name: 'contenteditable-any', selector: '[contenteditable]:not([contenteditable="false"])' },

  // ARIA landmarks. Slowest-moving signals; these are the safety net.
  { name: 'aria-document', selector: '[role="document"]' },
  { name: 'aria-textbox', selector: '[role="textbox"]' },
  { name: 'aria-main', selector: '[role="main"]' },
  { name: 'main-element', selector: 'main' },
];

/**
 * Minimum visible characters a candidate must contain to be accepted as the
 * content root. Below this we assume we matched a toolbar or an empty shell
 * and fall through to the next candidate.
 */
export const MIN_CONTENT_ROOT_CHARS = 40;

// ---------------------------------------------------------------------------
// Page title
// ---------------------------------------------------------------------------

/** Ordered candidates for the page title, most specific first. UNVERIFIED. */
export const TITLE_CANDIDATES: readonly string[] = [
  '[data-testid="page-title"]',
  '[class*="pageTitle" i]',
  '[class*="titleInput" i]',
  '[role="main"] [role="heading"][aria-level="1"]',
  'h1',
];

// ---------------------------------------------------------------------------
// Chrome to exclude from the export
// ---------------------------------------------------------------------------

/**
 * Subtrees that are UI furniture rather than page content. Matched elements
 * (and their descendants) are skipped entirely by the converter.
 */
export const EXCLUDE_SELECTORS: readonly string[] = [
  // Editor affordances that render inside the content region.
  '[data-testid="comment-thread"]',
  '[class*="commentThread" i]',
  '[class*="Toolbar" i]',
  '[role="toolbar"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="tooltip"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="status"]',
  '[role="banner"]',
  '[role="navigation"]',
  '[role="complementary"]',
  '[role="search"]',
  // Loop renders a persistent "+" / drag handle rail beside each block.
  '[class*="blockHandle" i]',
  '[class*="dragHandle" i]',
  '[data-testid="block-handle"]',
  // Presence cursors and collaborator avatars.
  '[class*="presence" i]',
  '[class*="collabCursor" i]',
  // Anything explicitly hidden from assistive tech is also not content.
  '[aria-hidden="true"]',
  '[hidden]',
  // loopmark's own overlay, so re-running does not capture the previous run.
  'loopmark-overlay',
];

// ---------------------------------------------------------------------------
// Disclosure expansion (Phase 1 `expandCollapsed`)
// ---------------------------------------------------------------------------

/**
 * ALLOWLIST -- the only things loopmark will ever click.
 *
 * Clicking in a live collaborative editor is the single riskiest thing this
 * tool does, so the rule is narrow: an element must match one of these AND
 * carry `aria-expanded="false"`. We never click a generic button, never click
 * anything matching DANGEROUS_CLICK_PATTERNS, and never click twice.
 */
export const EXPANDABLE_ALLOWLIST: readonly string[] = [
  // Native disclosure.
  'summary[aria-expanded="false"]',
  // ARIA disclosure buttons for collapsed headings / sections.
  'button[aria-expanded="false"][class*="collaps" i]',
  'button[aria-expanded="false"][class*="expand" i]',
  'button[aria-expanded="false"][class*="chevron" i]',
  'button[aria-expanded="false"][class*="disclosure" i]',
  '[role="button"][aria-expanded="false"][class*="collaps" i]',
  '[role="button"][aria-expanded="false"][class*="expand" i]',
  // Loop's "Show more" affordance on truncated blocks. UNVERIFIED.
  '[data-testid="show-more"][aria-expanded="false"]',
  // Collapsed outline headings expose aria-expanded on the heading itself.
  '[role="heading"][aria-expanded="false"]',
];

/**
 * Hard veto. If an element's text, aria-label, or class matches any of these,
 * it is never clicked regardless of the allowlist. Defense in depth against a
 * future allowlist entry accidentally widening to a destructive control.
 */
export const DANGEROUS_CLICK_PATTERNS: readonly RegExp[] = [
  /delete|remove|trash|discard/i,
  /share|invite|publish|send/i,
  /copy\s*link|move|rename/i,
  /sign\s*out|log\s*out/i,
  /new|add|create|insert/i,
  /settings|options|menu/i,
  /comment|reply|resolve/i,
];

/** Never click more than this many disclosures -- a runaway loop guard. */
export const MAX_EXPAND_CLICKS = 200;

// ---------------------------------------------------------------------------
// Virtualization (Phase 1 `forceRender`)
// ---------------------------------------------------------------------------

export const FORCE_RENDER = {
  /** Number of scroll positions to visit between top and bottom. */
  steps: 8,
  /** Milliseconds to wait after each scroll for React to commit new rows. */
  settleMs: 120,
  /** Extra wait at the bottom, where the largest batch usually renders. */
  bottomSettleMs: 350,
  /** Abort scrolling after this long, so a huge page cannot hang the click. */
  budgetMs: 8000,
} as const;

// ---------------------------------------------------------------------------
// Loop component detection (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Live Loop components become static snapshots. Each entry maps a selector to
 * the label used in the fenced-block info string. UNVERIFIED.
 */
export const COMPONENT_SELECTORS: readonly { kind: string; selector: string }[] = [
  { kind: 'loop-task-list', selector: '[data-testid="task-list"]' },
  { kind: 'loop-voting-table', selector: '[data-testid="voting-table"]' },
  { kind: 'loop-progress-tracker', selector: '[data-testid="progress-tracker"]' },
  { kind: 'loop-kanban', selector: '[data-testid="kanban-board"]' },
  { kind: 'loop-component', selector: '[data-loop-component]' },
  { kind: 'loop-component', selector: '[class*="loopComponent" i]' },
];

/** Person chips / @mentions, flattened to their display name. UNVERIFIED. */
export const MENTION_SELECTORS: readonly string[] = [
  '[data-testid="mention"]',
  '[class*="mention" i]',
  '[class*="personaChip" i]',
  'span[data-lpc-mention]',
];

// ---------------------------------------------------------------------------
// Callout -> GitHub Alert mapping (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Loop callouts carry their type in a class or data attribute. Ordered because
 * the first match wins; put narrower patterns first.
 */
export const CALLOUT_PATTERNS: readonly { pattern: RegExp; alert: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION' }[] = [
  { pattern: /danger|error|critical|blocker/i, alert: 'CAUTION' },
  { pattern: /warn|caution|risk/i, alert: 'WARNING' },
  { pattern: /important|key|highlight/i, alert: 'IMPORTANT' },
  { pattern: /tip|hint|success|idea/i, alert: 'TIP' },
  { pattern: /note|info|callout/i, alert: 'NOTE' },
];
