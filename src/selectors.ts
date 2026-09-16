/**
 * ALL Loop-specific DOM knowledge lives in this file.
 *
 * When Microsoft ships a UI change and loopmark stops working, this should be
 * the only file that needs editing. Everything here is a description of
 * someone else's unversioned, undocumented markup -- treat each entry as
 * expiring.
 *
 * Loop's editor is internally called **Scriptor**, and it prefixes its class
 * names accordingly (`scriptor-paragraph`, `scriptor-pageContainer`, ...).
 * Class names are matched case-insensitively and by substring wherever
 * possible, because Loop ships hashed/suffixed variants of them.
 *
 * CONVENTION: every entry carries
 *   - what it targets
 *   - VERIFIED <date> <how>  if confirmed against live markup
 *   - UNVERIFIED             if it is a structural guess
 *
 * Selector knowledge marked "via loopd" was derived from the MIT-licensed
 * github.com/stuffbucket/loopd. See NOTICE.
 */

// ---------------------------------------------------------------------------
// Host guard
// ---------------------------------------------------------------------------

/**
 * Hosts on which the bookmarklet runs without complaint.
 * Add tenant-specific hosts here; matching is exact or subdomain-suffix.
 */
export const LOOP_HOSTS: readonly string[] = [
  // VERIFIED 2026-09-16 -- the current Loop web app.
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
 * Tried in order; the first that clears a minimum-content threshold wins, so
 * specific-and-fragile can safely sit above generic-and-stable. To recover
 * from a Loop UI change, add one entry.
 */
export const CONTENT_ROOT_CANDIDATES: readonly { name: string; selector: string }[] = [
  // VERIFIED 2026-09-16 via loopd -- Scriptor's own page containers.
  { name: 'scriptor-page-container', selector: 'div.scriptor-pageContainer' },
  { name: 'page-container-fuzzy', selector: 'div[class*="pageContainer" i]' },
  { name: 'scriptor-first-page', selector: '.scriptor-pageFrame.scriptor-firstPage' },
  { name: 'scriptor-page-body', selector: '.scriptor-pageBody' },
  { name: 'scriptor-page-frame', selector: '.scriptor-pageFrame' },
  { name: 'scriptor-canvas', selector: '.scriptor-canvas' },
  // Loop components embedded in a host page (Teams, Outlook, a Loop workspace).
  { name: 'component-part-host', selector: '[id^="componentPartHostingElementId"]' },

  // Structural fallbacks. Loop pages are editable documents, so the
  // contenteditable region is a strong signal independent of class names.
  { name: 'main-contenteditable', selector: '[role="main"] [contenteditable="true"]' },
  { name: 'contenteditable-true', selector: '[contenteditable="true"]' },
  { name: 'contenteditable-any', selector: '[contenteditable]:not([contenteditable="false"])' },

  // ARIA landmarks. Slowest-moving signals; the safety net.
  { name: 'aria-document', selector: '[role="document"]' },
  { name: 'aria-main', selector: '[role="main"]' },
  { name: 'main-element', selector: 'main' },
];

/**
 * Last-ditch strategy when every candidate fails: find the nearest ancestor
 * that contains several paragraph blocks. Survives a wholesale class rename
 * of the page container as long as the paragraph class holds.
 */
export const PARAGRAPH_SELECTOR = '.scriptor-paragraph, [class*="scriptor-paragraph" i]';
export const MIN_PARAGRAPHS_FOR_ROOT = 3;

/**
 * Minimum visible characters a candidate must contain to be accepted. Below
 * this we assume we matched a toolbar or an empty shell and fall through.
 */
export const MIN_CONTENT_ROOT_CHARS = 40;

// ---------------------------------------------------------------------------
// Page title
// ---------------------------------------------------------------------------

/** Ordered title candidates. VERIFIED 2026-09-16 via loopd. */
export const TITLE_CANDIDATES: readonly string[] = [
  '.scriptor-pageTitle',
  '[data-automation-type="Title"]',
  '[class*="pageTitle" i]',
  '[role="main"] [role="heading"][aria-level="1"]',
  'h1',
];

// ---------------------------------------------------------------------------
// Chrome to exclude from the export
// ---------------------------------------------------------------------------

/**
 * Subtrees that are UI furniture rather than page content. Matched elements
 * and their descendants are skipped entirely.
 */
export const EXCLUDE_SELECTORS: readonly string[] = [
  // VERIFIED 2026-09-16 via loopd -- the page header carries the cover image,
  // author chips and presence avatars, none of which are document content.
  '.scriptor-pageHeader',
  '[class*="scriptor-pageHeader" i]',

  // The page title is read separately by `findTitle` and rendered as the
  // document's `# ` heading, so including it in the body duplicates it.
  '.scriptor-pageTitle',
  '[data-automation-type="Title"]',

  // Editor affordances rendered inside the content region.
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

  // The "+" / drag rail beside each block.
  '[class*="blockHandle" i]',
  '[class*="dragHandle" i]',
  '[data-testid="block-handle"]',

  // Presence cursors and collaborator avatars.
  '[class*="presence" i]',
  '[class*="collabCursor" i]',

  /**
   * Editor chrome discovered in a saved Loop page, 2026-09-16.
   * Every one of these renders visible text that is not document content.
   */
  // The hover rail of block commands ("+", drag, context menu) beside each block.
  '.scriptor-blocks-commands-wrapper',
  '.scriptor-blocks-commands-hover',
  '[data-automation-type="BlockContextMenuButton"]',
  // "New changes. Select to learn who made new changes." unread marker; its
  // accessible name leaks the bare word "New" into the text flow.
  '.scriptor-block-bluedot',
  // The "Add alt text" affordance that appears over an image on hover.
  '.scriptor-image-alt-widget',
  // Zero-width runs Scriptor uses for cursor placement, and screen-reader-only
  // containers that duplicate content already present in the flow.
  '.scriptor-nonDisplayable-textRun',
  '.scriptor-placeholder-aria-hidden',
  '.scriptor-alwaysAccessibleElementContainer',
  // Table furniture: the column-resize grabbers and the parallel, aria-hidden
  // "column grabber" table that mirrors the real one row for row.
  '[data-automation-type="column-grabber-table"]',
  '[data-automation-type="table-column-resize-element"]',

  // Buttons are affordances, never prose. Loop puts a "New" row button inside
  // every table, "Go to line" / "Show more lines" inside every code block, and
  // a vote toggle inside every voting cell -- all of which otherwise land in
  // the text flow. Voting is recovered separately, see VOTING_SELECTOR.
  'button',
  '[role="button"]',
  'input',
  'select',
  // Fluent UI renders screen-reader-only help text into a div that is merely
  // referenced by `aria-describedby`, so it is visible to a text walk.
  '[id*="AriaDescription" i]',

  /**
   * IMPORTANT: Loop renders a duplicate, `aria-hidden` copy of list items that
   * belong to an earlier list via `aria-owns`. Excluding aria-hidden subtrees
   * is what stops every bullet in an owned list appearing twice.
   * VERIFIED 2026-09-16 via loopd.
   */
  '[aria-hidden="true"]',
  '[hidden]',

  // loopmark's own overlay, so re-running does not capture the previous run.
  'loopmark-overlay',
];

// ---------------------------------------------------------------------------
// Disclosure expansion
// ---------------------------------------------------------------------------

/**
 * ALLOWLIST -- the only things loopmark will ever click.
 *
 * Clicking in a live collaborative editor is the riskiest thing this tool
 * does, so the rule is narrow: an element must match one of these AND carry
 * `aria-expanded="false"` AND survive `DANGEROUS_CLICK_PATTERNS`.
 */
export const EXPANDABLE_ALLOWLIST: readonly string[] = [
  // VERIFIED 2026-09-16 via loopd -- Scriptor's collapsed-heading toggle.
  '[class*="scriptor-collapseButtonContainer" i][aria-expanded="false"]',

  // Native disclosure.
  'summary[aria-expanded="false"]',

  // Generic ARIA disclosure buttons.
  'button[aria-expanded="false"][class*="collaps" i]',
  'button[aria-expanded="false"][class*="expand" i]',
  'button[aria-expanded="false"][class*="chevron" i]',
  'button[aria-expanded="false"][class*="disclosure" i]',
  '[role="button"][aria-expanded="false"][class*="collaps" i]',
  '[role="button"][aria-expanded="false"][class*="expand" i]',

  // Collapsed outline headings expose aria-expanded on the heading itself.
  '[role="heading"][aria-expanded="false"]',
];

/**
 * Hard veto. If an element's text, aria-label, or class matches any of these
 * it is never clicked, regardless of the allowlist. Defense in depth against a
 * future allowlist entry widening to reach a destructive control.
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
// Virtualization
// ---------------------------------------------------------------------------

export const FORCE_RENDER = {
  /** Scroll positions to visit between top and bottom. */
  steps: 8,
  /** Milliseconds to wait after each scroll for new rows to commit. */
  settleMs: 120,
  /** Extra wait at the bottom, where the largest batch usually renders. */
  bottomSettleMs: 350,
  /** Abort after this long, so a huge page degrades rather than hanging. */
  budgetMs: 8000,
} as const;

// ---------------------------------------------------------------------------
// Block-level class patterns
//
// Loop expresses most block types through class names rather than tags, so
// these are the real classifiers. All VERIFIED 2026-09-16 via loopd.
// ---------------------------------------------------------------------------

/** A heading, even when the tag is a plain div. */
export const HEADING_CLASS_PATTERN =
  /scriptor-collapsibleHeading|scriptor-heading|scriptor-title/i;

/** Some headings encode their rank in the class, e.g. `...heading2...`. */
export const HEADING_LEVEL_CLASS_PATTERN = /heading\s*(\d)/i;

/** Loop's paragraph block. Its inner `scriptor-line` children are soft lines. */
export const PARAGRAPH_CLASS_PATTERN = /scriptor-paragraph/i;

/** A checklist / task item. */
export const TASK_CLASS_PATTERN = /scriptor-task|scriptor-checkbox/i;

/** Callout blocks, mapped to GitHub Alerts. */
export const CALLOUT_CLASS_PATTERN =
  /scriptor-callout|scriptor-infoBlock|scriptor-highlightBlock|scriptor-component-block-callout|scriptor-block-callout/i;

/** Fenced code blocks. */
/**
 * A real, standalone code block. NOT `scriptor-code-editor` -- despite the
 * name, that class marks *inline* code runs on `.scriptor-textRun` spans, and
 * treating it as a block turns every inline snippet into its own fenced block.
 * VERIFIED 2026-09-16 against a saved Loop page.
 */
export const CODE_BLOCK_CLASS_PATTERN =
  /scriptor-component-code-block|scriptor-codeBlock|code-snippet/i;

/** Inline code spans. */
/**
 * Inline code. Loop fragments a single snippet across many sibling spans
 * tagged `scriptor-code-first` / `-middle` / `-last`, sometimes one character
 * each, so adjacent runs must be merged before rendering.
 * VERIFIED 2026-09-16 against a saved Loop page.
 */
export const INLINE_CODE_CLASS_PATTERN = /scriptor-inlineCode|scriptor-code-editor/i;

/** Horizontal rules. */
export const DIVIDER_CLASS_PATTERN = /scriptor-divider|scriptor-horizontalRule/i;

/** Table rows and cells, for tables rendered without `<table>` tags. */
export const TABLE_ROW_CLASS_PATTERN = /scriptor-tableRow/i;
export const TABLE_CELL_CLASS_PATTERN = /scriptor-tableCell/i;

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * Loop does NOT use `<a href>` for links.
 *
 * It renders `<span class="scriptor-hyperlink" role="link" title="...">`, with
 * the destination stored in the `title` attribute in the form:
 *
 *     https://example.invalid/page\nClick to follow link
 *
 * Missing this means every URL on the page is silently dropped while the
 * output still looks plausible. VERIFIED 2026-09-16 via loopd.
 */
export const LINK_CLASS_PATTERN = /scriptor-hyperlink/i;

/** Trailing instruction text appended to the `title` attribute of a link. */
export const LINK_TITLE_SUFFIX = /\s*\n\s*click to follow link\s*$/i;

// ---------------------------------------------------------------------------
// Loop component detection
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
];

/** Person chips / @mentions, flattened to their display name. UNVERIFIED. */
export const MENTION_SELECTORS: readonly string[] = [
  '[data-testid="mention"]',
  '[class*="mention" i]',
  '[class*="personaChip" i]',
  'span[data-lpc-mention]',
];

// ---------------------------------------------------------------------------
// Callout -> GitHub Alert mapping
// ---------------------------------------------------------------------------

/**
 * Matched against the element's class list plus its `data-type` /
 * `data-callout-type` attributes. Ordered: the first match wins, so narrower
 * patterns come first.
 */
export const CALLOUT_PATTERNS: readonly {
  pattern: RegExp;
  alert: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';
}[] = [
  { pattern: /danger|error|critical|blocker/i, alert: 'CAUTION' },
  { pattern: /caution/i, alert: 'CAUTION' },
  { pattern: /warn|risk/i, alert: 'WARNING' },
  { pattern: /important|key|highlight/i, alert: 'IMPORTANT' },
  { pattern: /tip|hint|success|idea/i, alert: 'TIP' },
  { pattern: /note|info|callout/i, alert: 'NOTE' },
];

/**
 * Scriptor terminates every paragraph with `<br class="scriptor-EOP">`
 * (End Of Paragraph). Treating it as a real `<br>` appends a stray `\` hard
 * break to the end of every single line of output.
 * VERIFIED 2026-09-16 against a saved Loop page.
 */
export const EOP_CLASS_PATTERN = /scriptor-EOP/i;

/**
 * Loop embeds block-level components *inside* a paragraph:
 *
 *   div.scriptor-paragraph
 *     span.scriptor-inline
 *       div.scriptor-hosting-element.scriptor-component-block
 *         div[data-automation-type="Tablero"]
 *           table[role="table"][data-automation-type="user-data-table"]
 *
 * Classifying that outer paragraph (or the inline span) by its own class alone
 * flattens the entire table into run-on text. Any element matching one of
 * these in its subtree must be descended into instead.
 *
 * VERIFIED 2026-09-16 against a saved Loop page.
 */
export const EMBEDDED_BLOCK_SELECTOR = [
  'table',
  '[role="table"]',
  '[role="grid"]',
  '[data-automation-type="Tablero"]',
  '[data-automation-type="user-data-table"]',
  '.scriptor-hosting-element',
  '.scriptor-component-block',
  '.scriptor-component-code-block',
  '.scriptor-horizontal-divider',
  'pre',
  'ul',
  'ol',
  'blockquote',
].join(', ');

/**
 * Loop's table component. The real data table is nested several levels below
 * the Tablero host; the host itself is just a positioning wrapper.
 * VERIFIED 2026-09-16 against a saved Loop page.
 */
export const TABLE_HOST_SELECTOR =
  '[data-automation-type="Tablero"], [data-automation-type="user-data-table"]';

/**
 * Loop's voting component. The visible control is a button (excluded above),
 * so the tally is recovered from its accessible name, "3 voters. Click to
 * vote." -- otherwise every vote column exports as blank.
 * VERIFIED 2026-09-16 against a saved Loop page.
 */
export const VOTING_SELECTOR =
  '[data-testid="voting-container-test-id"], [data-automation-type="voting" i]';
export const VOTER_COUNT_PATTERN = /(\d+)\s+voters?/i;
