/**
 * HTML -> GitHub-flavored Markdown.
 *
 * Two halves, deliberately separable:
 *   1. `domToBlocks` walks the composed DOM and produces the `Block[]` IR.
 *   2. `renderBlocks` turns that IR into Markdown text.
 *
 * No dependencies, at build time or run time.
 */

import { composedChildren, composedText, pierceGetElementById } from './acquire.js';
import {
  CALLOUT_CLASS_PATTERN,
  CALLOUT_PATTERNS,
  CODE_BLOCK_CLASS_PATTERN,
  COMPONENT_SELECTORS,
  DIVIDER_CLASS_PATTERN,
  EXCLUDE_SELECTORS,
  HEADING_CLASS_PATTERN,
  HEADING_LEVEL_CLASS_PATTERN,
  INLINE_CODE_CLASS_PATTERN,
  LINK_CLASS_PATTERN,
  LINK_TITLE_SUFFIX,
  MENTION_SELECTORS,
  PARAGRAPH_CLASS_PATTERN,
  TABLE_CELL_CLASS_PATTERN,
  TABLE_ROW_CLASS_PATTERN,
  TASK_CLASS_PATTERN,
  EMBEDDED_BLOCK_SELECTOR,
  EOP_CLASS_PATTERN,
  VOTER_COUNT_PATTERN,
  VOTING_SELECTOR,
  LIST_MARKER_CSS_VAR,
  ORDERED_MARKER_PATTERN,
  BULLET_MARKER_PATTERN,
  CODE_CHROME_SELECTOR,
  CODE_LANGUAGE_ALIASES,
  CODE_LANGUAGE_SELECTOR,
  TABLE_COUNT_SELECTOR,
  COLLAPSED_SECTION_SELECTOR,
} from './selectors.js';
import type {
  AlertKind,
  Block,
  ConversionResult,
  Diagnostics,
  DocMeta,
  HeadingLevel,
  Inline,
  ListItem,
  LoopDoc,
} from './types.js';

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

const isElement = (node: Node): node is Element => node.nodeType === 1;
const isText = (node: Node): node is Text => node.nodeType === 3;

/**
 * Compile a selector list into a single predicate.
 *
 * Joining into one selector string matters: `EXCLUDE_SELECTORS` is tested
 * against every element on the page, and 24 separate `matches()` calls per
 * element turns into millions on a large document. Invalid entries are
 * dropped once at compile time rather than throwing per element.
 */
function makeMatcher(selectors: readonly string[]): (el: Element) => boolean {
  const valid: string[] = [];
  for (const selector of selectors) {
    try {
      document.createDocumentFragment().querySelector(selector);
      valid.push(selector);
    } catch {
      // Selector not supported by this browser -- skip it silently.
    }
  }
  if (valid.length === 0) return () => false;
  const joined = valid.join(',');
  return (el: Element): boolean => {
    try {
      return el.matches(joined);
    } catch {
      return false;
    }
  };
}

let matchExcluded: ((el: Element) => boolean) | null = null;
let matchMention: ((el: Element) => boolean) | null = null;

function excluded(el: Element): boolean {
  matchExcluded ??= makeMatcher(EXCLUDE_SELECTORS);
  return matchExcluded(el);
}

function isMention(el: Element): boolean {
  matchMention ??= makeMatcher(MENTION_SELECTORS);
  return matchMention(el);
}

/** Reset compiled matchers. Tests use this when swapping DOM implementations. */
export function resetMatchers(): void {
  matchExcluded = null;
  matchMention = null;
}

function componentKind(el: Element): string | null {
  for (const { kind, selector } of COMPONENT_SELECTORS) {
    try {
      if (el.matches(selector)) return kind;
    } catch {
      // ignore unsupported selector
    }
  }
  return null;
}

/** `className` is an SVGAnimatedString on SVG elements, not a string. */
export function classOf(el: Element): string {
  const value = (el as HTMLElement).className;
  return typeof value === 'string' ? value : (el.getAttribute('class') ?? '');
}

const attrBag = (el: Element): string =>
  [
    classOf(el),
    el.getAttribute('data-testid') ?? '',
    el.getAttribute('data-callout-type') ?? '',
    el.getAttribute('data-type') ?? '',
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('role') ?? '',
  ].join(' ');

// ---------------------------------------------------------------------------
// Element classification
// ---------------------------------------------------------------------------

/**
 * Tags that participate in a line of text rather than breaking it.
 * Anything NOT in this set and not otherwise recognized is treated as a block
 * container, which is the right default for the div soup an editor produces.
 */
const INLINE_TAGS = new Set([
  'SPAN', 'A', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'DEL', 'INS',
  'CODE', 'KBD', 'SAMP', 'VAR', 'SUB', 'SUP', 'MARK', 'SMALL', 'ABBR', 'CITE',
  'Q', 'TIME', 'IMG', 'BR', 'LABEL', 'FONT', 'BIG', 'TT', 'BDI', 'BDO',
  'RUBY', 'RT', 'RP', 'WBR', 'NOBR', 'DFN',
]);

/** Containers we expect to see; anything else is worth reporting in diagnostics. */
const KNOWN_CONTAINERS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'NAV',
  'FORM', 'FIELDSET', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'ADDRESS',
  'BODY', 'HTML', 'TEMPLATE', 'SLOT', 'DETAILS', 'SUMMARY', 'CENTER',
]);

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK',
  // Form controls carry no document text. Checkbox *state* is read directly by
  // `checkedState`, so skipping them here loses nothing and avoids emitting an
  // empty container for every checklist item.
  'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'OPTGROUP', 'PROGRESS', 'METER',
]);

type Kind =
  | 'skip'
  | 'inline'
  | 'heading'
  | 'list'
  | 'table'
  | 'code'
  | 'quote'
  | 'break'
  | 'component'
  | 'paragraph'
  | 'task'
  | 'container';

function classify(el: Element): Kind {
  const tag = el.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag)) return 'skip';
  if (excluded(el)) return 'skip';

  const role = (el.getAttribute('role') ?? '').toLowerCase();
  const cls = classOf(el);

  // Headings first, and by ARIA/class before tag name. This is the fix for
  // Loop emitting headings as list items: role wins over ancestry.
  if (
    role === 'heading' ||
    /^H[1-6]$/.test(tag) ||
    HEADING_CLASS_PATTERN.test(cls) ||
    (el.getAttribute('data-automation-type') ?? '').toLowerCase().includes('heading')
  ) {
    return 'heading';
  }

  // Routed to the inline path so `votingSummary` can recover the tally from the
  // button's accessible name before the button itself is excluded.
  try {
    if (el.matches(VOTING_SELECTOR)) return 'inline';
  } catch {
    // ignore unsupported selector
  }

  if (componentKind(el)) return 'component';
  if (isMention(el)) return 'inline';

  if (tag === 'PRE' || CODE_BLOCK_CLASS_PATTERN.test(cls)) return 'code';
  if (tag === 'HR' || role === 'separator' || DIVIDER_CLASS_PATTERN.test(cls)) return 'break';
  if (tag === 'TABLE' || role === 'table' || role === 'grid') return 'table';
  // A Scriptor table container, but never a row or a cell. UNVERIFIED.
  if (
    /scriptor-table/i.test(cls) &&
    !TABLE_ROW_CLASS_PATTERN.test(cls) &&
    !TABLE_CELL_CLASS_PATTERN.test(cls)
  ) {
    return 'table';
  }
  if (tag === 'UL' || tag === 'OL' || tag === 'MENU' || role === 'list') return 'list';
  if (tag === 'BLOCKQUOTE' || role === 'note' || CALLOUT_CLASS_PATTERN.test(cls) || isCalloutish(el)) {
    return 'quote';
  }
  // A task item that is not inside a <ul>; merged into a neighbouring list.
  if (TASK_CLASS_PATTERN.test(cls)) return 'task';

  // `paragraph` and `inline` both flatten their subtree to inline content, so
  // neither may be applied to an element that *hosts* a block-level component.
  // Loop nests tables, code blocks and dividers inside a `.scriptor-paragraph`,
  // and the flattening is what turned every table into run-on text.
  if (PARAGRAPH_CLASS_PATTERN.test(cls)) {
    return containsEmbeddedBlock(el) ? 'container' : 'paragraph';
  }

  if (INLINE_TAGS.has(tag)) {
    return containsEmbeddedBlock(el) ? 'container' : 'inline';
  }
  return 'container';
}

/**
 * Does this element host block-level content that must not be flattened?
 *
 * Deliberately a light-DOM `querySelector`: it runs for every paragraph and
 * inline span on the page, and Loop renders its components into the light DOM.
 * A composed-tree search here would be correct but far too slow to be worth it.
 */
function containsEmbeddedBlock(el: Element): boolean {
  try {
    return el.querySelector(EMBEDDED_BLOCK_SELECTOR) !== null;
  } catch {
    return false;
  }
}

/** Is this heading's section collapsed, hiding everything beneath it? */
function isCollapsedSection(el: Element): boolean {
  try {
    return el.querySelector(COLLAPSED_SECTION_SELECTOR) !== null;
  } catch {
    return false;
  }
}

function isCalloutish(el: Element): boolean {
  // A dedicated attribute is a stronger signal than class-name sniffing, and
  // its *value* ("note", "warning") will not contain the word "callout".
  if (el.hasAttribute('data-callout-type')) return true;
  return /callout|admonition|banner-message|infobox/i.test(attrBag(el));
}

function calloutAlert(el: Element): AlertKind | null {
  const bag = attrBag(el);
  for (const { pattern, alert } of CALLOUT_PATTERNS) {
    if (pattern.test(bag)) return alert;
  }
  return null;
}

function headingLevel(el: Element): HeadingLevel {
  const aria = el.getAttribute('aria-level');
  if (aria) {
    const n = parseInt(aria, 10);
    if (n >= 1 && n <= 6) return n as HeadingLevel;
  }
  const m = /^H([1-6])$/.exec(el.tagName.toUpperCase());
  if (m?.[1]) return parseInt(m[1], 10) as HeadingLevel;
  // Some Loop headings encode their rank in the class, e.g. `...heading2...`.
  const fromClass = HEADING_LEVEL_CLASS_PATTERN.exec(classOf(el));
  if (fromClass?.[1]) {
    const n = parseInt(fromClass[1], 10);
    if (n >= 1 && n <= 6) return n as HeadingLevel;
  }
  return 3; // A heading of unknown rank is more likely a subsection than a title.
}

// ---------------------------------------------------------------------------
// Inline conversion
// ---------------------------------------------------------------------------

function computed(el: Element): CSSStyleDeclaration | null {
  try {
    return getComputedStyle(el);
  } catch {
    return null;
  }
}

/**
 * Does `el` *introduce* this formatting, as opposed to inheriting it?
 *
 * This distinction is load-bearing. Computed style inherits, so every <span>
 * inside a <strong> also computes to weight 700. Checking the absolute value
 * would wrap the same run of text once per nesting level and emit
 * `****text****`, which no Markdown parser reads as bold. Emphasis is a
 * *change* in formatting, so we compare against the parent.
 */
function introduces(
  el: Element,
  read: (style: CSSStyleDeclaration) => string,
  inlineValue: string,
  test: (value: string) => boolean,
): boolean {
  if (test(inlineValue)) {
    const parent = el.parentElement ? computed(el.parentElement) : null;
    if (!parent || !test(read(parent))) return true;
  }
  const own = computed(el);
  if (!own || !test(read(own))) return false;
  const parent = el.parentElement ? computed(el.parentElement) : null;
  // Parent already has it -> inherited, not introduced here.
  return !(parent && test(read(parent)));
}

const isBoldWeight = (v: string): boolean => /^(bold|bolder|[6-9]00)$/.test(v.trim());
const isItalicStyle = (v: string): boolean => /italic|oblique/.test(v);
const isStruck = (v: string): boolean => /line-through/.test(v);

function styleSaysBold(el: Element): boolean {
  return introduces(el, (s) => s.fontWeight, (el as HTMLElement).style?.fontWeight ?? '', isBoldWeight);
}

function styleSaysItalic(el: Element): boolean {
  return introduces(el, (s) => s.fontStyle, (el as HTMLElement).style?.fontStyle ?? '', isItalicStyle);
}

function styleSaysStrike(el: Element): boolean {
  return introduces(
    el,
    (s) => s.textDecorationLine || s.textDecoration || '',
    (el as HTMLElement).style?.textDecoration ?? '',
    isStruck,
  );
}

/**
 * Find a link's destination.
 *
 * Loop does not use `<a href>`. It renders
 * `<span class="scriptor-hyperlink" role="link" title="URL\nClick to follow link">`,
 * so the destination has to be recovered from the `title` attribute. Missing
 * this drops every URL on the page while the output still looks plausible.
 */
export function resolveHref(el: Element): string {
  const direct = el.getAttribute('href') ?? el.getAttribute('data-href') ?? '';
  if (direct) return direct;

  const title = (el.getAttribute('title') ?? '').replace(LINK_TITLE_SUFFIX, '').trim();
  const first = (title.split('\n')[0] ?? '').trim();
  // Only accept something that actually looks like a destination -- a `title`
  // is a tooltip on most elements, and tooltips are not links.
  return /^(https?:\/\/|mailto:|tel:|\/)/i.test(first) ? first : '';
}

interface Ctx {
  diag: Diagnostics;
  imageUrls: string[];
  /** Depth guard -- a malformed or cyclic composed tree must not blow the stack. */
  depth: number;
  /** How many tables deep the walk currently is. */
  tableDepth: number;
}

const MAX_DEPTH = 120;

/** Convert the children of `el` to inline nodes. */
function inlineChildren(el: Node, ctx: Ctx): Inline[] {
  const out: Inline[] = [];
  for (const child of composedChildren(el)) out.push(...toInline(child, ctx));
  return out;
}

/**
 * Loop stamps every unlabelled image with the literal alt text
 * "Image has no description", which is noise in the output rather than a
 * description. Normalise it (and the empty case) to a neutral word.
 */
const LOOP_EMPTY_ALT = /^\s*(image has no description|add alt text)\s*$/i;

/** Href used in place of an omitted inline base64 image. */
export const DATA_IMAGE_PLACEHOLDER = '#image-omitted';

function imageAlt(el: Element): string {
  const alt = el.getAttribute('alt') ?? el.getAttribute('aria-label') ?? '';
  return LOOP_EMPTY_ALT.test(alt) || !alt.trim() ? 'image' : alt;
}

/** Render a Loop voting cell as its tally, or `null` if this is not one. */
function votingSummary(el: Element): string | null {
  try {
    if (!el.matches(VOTING_SELECTOR)) return null;
  } catch {
    return null;
  }
  const labelled = el.hasAttribute('aria-label') ? el : el.querySelector('[aria-label]');
  const match = VOTER_COUNT_PATTERN.exec(labelled?.getAttribute('aria-label') ?? '');
  const count = match?.[1] ? parseInt(match[1], 10) : 0;
  return count === 1 ? '1 vote' : `${count} votes`;
}

function isDataUri(src: string): boolean {
  return /^data:/i.test(src.trim());
}

function toInline(node: Node, ctx: Ctx): Inline[] {
  if (ctx.depth > MAX_DEPTH) return [];

  if (isText(node)) {
    const value = (node.nodeValue ?? '').replace(/\s+/g, ' ');
    return value ? [{ type: 'text', value }] : [];
  }
  if (!isElement(node)) return [];

  const tag = node.tagName.toUpperCase();

  // Checked before the exclusions, because the tally lives on a <button>.
  const votes = votingSummary(node);
  if (votes !== null) return [{ type: 'text', value: votes }];

  if (SKIP_TAGS.has(tag) || excluded(node)) return [];

  ctx.depth += 1;
  try {
    if (tag === 'BR') {
      // `<br class="scriptor-EOP">` is Scriptor's end-of-paragraph sentinel,
      // not an author-authored line break. Emitting it appends a stray `\`
      // to the end of every line in the document.
      if (EOP_CLASS_PATTERN.test(classOf(node))) return [];
      return [{ type: 'break' }];
    }

    if (tag === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      const alt = imageAlt(node);
      // Only real, resolvable URLs belong in the appendix; a base64 payload
      // is not a reference anyone can follow.
      if (src && !isDataUri(src)) ctx.imageUrls.push(src);
      if (!src) return [];
      // A pasted Loop image is an inline base64 `data:` URI, routinely
      // hundreds of kilobytes. Inlining one produces a single unreadable line
      // far larger than the rest of the document, so record a placeholder.
      if (isDataUri(src)) {
        ctx.diag.droppedDataImages += 1;
        return [{ type: 'image', alt, src: DATA_IMAGE_PLACEHOLDER }];
      }
      return [{ type: 'image', alt, src }];
    }

    if (isMention(node)) {
      const name = composedText(node).replace(/\s+/g, ' ').trim();
      return name ? [{ type: 'mention', name }] : [];
    }

    const cls = classOf(node);
    const role = (node.getAttribute('role') ?? '').toLowerCase();

    if (tag === 'A' || role === 'link' || LINK_CLASS_PATTERN.test(cls)) {
      const href = resolveHref(node);
      const children = inlineChildren(node, ctx);
      if (!href) return children;
      // A link with no text still carries information: the renderer emits the
      // bare URL rather than dropping it entirely.
      return [{ type: 'link', href, children }];
    }

    if (
      tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT' ||
      INLINE_CODE_CLASS_PATTERN.test(cls)
    ) {
      // NOT trimmed: Loop splits one snippet across sibling spans, and the
      // space in `npm ci` can be the whole of the second span. Merging happens
      // in `mergeAdjacent`; the merged value is trimmed once, at render.
      const value = composedText(node).replace(/\s+/g, ' ');
      return value.trim() ? [{ type: 'code', value }] : [];
    }

    // Wrap children in marks. Order is fixed (del > strong > em) so that the
    // same DOM always produces the same delimiter nesting.
    let children = inlineChildren(node, ctx);
    if (children.length === 0) return [];

    const bold = tag === 'STRONG' || tag === 'B' || styleSaysBold(node);
    const italic = tag === 'EM' || tag === 'I' || tag === 'CITE' || styleSaysItalic(node);
    const strike = tag === 'DEL' || tag === 'S' || tag === 'STRIKE' || styleSaysStrike(node);

    if (italic) children = [{ type: 'em', children }];
    if (bold) children = [{ type: 'strong', children }];
    if (strike) children = [{ type: 'del', children }];
    return children;
  } finally {
    ctx.depth -= 1;
  }
}

// ---------------------------------------------------------------------------
// Block conversion
// ---------------------------------------------------------------------------

function inlineIsEmpty(nodes: Inline[]): boolean {
  return !nodes.some((n) => {
    if (n.type === 'text') return n.value.trim() !== '';
    if (n.type === 'code' || n.type === 'mention') return true;
    if (n.type === 'image') return true;
    // A link is never empty -- worst case it renders as its bare URL.
    if (n.type === 'link') return true;
    if (n.type === 'break') return false;
    return !inlineIsEmpty(n.children);
  });
}

/**
 * Merge adjacent inline nodes that carry the same mark.
 *
 * Loop's editor splits a single styled run across many sibling spans -- one
 * per edit, effectively -- so "One Runtime Images" arrives as three
 * separate bold runs and renders as `**One** **Runtime** **Images**`,
 * and an inline path arrives one character at a time. Merging first is what
 * makes the output read like prose instead of like a diff.
 */
function mergeAdjacent(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (prev && prev.type === node.type) {
      if (node.type === 'text' && prev.type === 'text') {
        out[out.length - 1] = { type: 'text', value: prev.value + node.value };
        continue;
      }
      if (node.type === 'code' && prev.type === 'code') {
        out[out.length - 1] = { type: 'code', value: prev.value + node.value };
        continue;
      }
      if (
        (node.type === 'strong' || node.type === 'em' || node.type === 'del') &&
        (prev.type === 'strong' || prev.type === 'em' || prev.type === 'del')
      ) {
        out[out.length - 1] = {
          type: node.type,
          children: mergeAdjacent([...prev.children, ...node.children]),
        } as Inline;
        continue;
      }
    }
    // A whitespace-only text node between two like marks is part of the run,
    // not a separator: `**A** **B**` is really one bold phrase "A B".
    if (node.type === 'text' && /^\s+$/.test(node.value) && out.length > 0) {
      const before = out[out.length - 1]!;
      if (before.type === 'strong' || before.type === 'em' || before.type === 'del') {
        out.push(node);
        continue;
      }
    }
    out.push(node);
  }
  return joinAcrossSpace(out);
}

/** Second pass: `<strong>A</strong> <strong>B</strong>` -> one `**A B**`. */
function joinAcrossSpace(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    const gap = nodes[i + 1];
    const next = nodes[i + 2];
    if (
      (node.type === 'strong' || node.type === 'em' || node.type === 'del') &&
      gap?.type === 'text' &&
      /^\s+$/.test(gap.value) &&
      next?.type === node.type
    ) {
      nodes[i + 2] = {
        type: node.type,
        children: [...node.children, { type: 'text', value: gap.value }, ...next.children],
      } as Inline;
      i += 1; // consume the gap; the merged node is handled on the next pass
      continue;
    }
    out.push(node);
  }
  return out;
}

function trimInline(nodes: Inline[]): Inline[] {
  const out = mergeAdjacent(nodes);
  while (out.length && out[0]!.type === 'break') out.shift();
  while (out.length && out[out.length - 1]!.type === 'break') out.pop();
  if (out.length) {
    const first = out[0]!;
    if (first.type === 'text') out[0] = { type: 'text', value: first.value.replace(/^\s+/, '') };
    const last = out[out.length - 1]!;
    if (last.type === 'text') {
      out[out.length - 1] = { type: 'text', value: last.value.replace(/\s+$/, '') };
    }
  }
  return out.filter((n) => !(n.type === 'text' && n.value === ''));
}

/**
 * Walk `el`'s children, producing block-level IR.
 *
 * Inline content accumulates in a buffer that is flushed to a paragraph
 * whenever a block-level child interrupts it.
 */
export function collectBlocks(el: Node, ctx: Ctx): Block[] {
  if (ctx.depth > MAX_DEPTH) return [];
  ctx.depth += 1;
  try {
    const out: Block[] = [];
    let pending: Inline[] = [];

    const flush = (): void => {
      const trimmed = trimInline(pending);
      pending = [];
      if (trimmed.length === 0 || inlineIsEmpty(trimmed)) return;
      // A lone image is a block-level figure, not a paragraph of one word.
      if (trimmed.length === 1 && trimmed[0]!.type === 'image') {
        const img = trimmed[0] as Extract<Inline, { type: 'image' }>;
        out.push({ type: 'image', alt: img.alt, src: img.src });
        return;
      }
      out.push({ type: 'paragraph', children: trimmed });
    };

    for (const child of composedChildren(el)) {
      if (isText(child)) {
        pending.push(...toInline(child, ctx));
        continue;
      }
      if (!isElement(child)) continue;

      const kind = classify(child);
      if (kind === 'skip') continue;
      if (kind === 'inline') {
        pending.push(...toInline(child, ctx));
        continue;
      }

      flush();
      switch (kind) {
        case 'heading': {
          const children = trimInline(inlineChildren(child, ctx));
          out.push({ type: 'heading', level: headingLevel(child), children });
          // A collapsed section's content is not in the page at all. Saying so
          // here, where it belongs, beats dropping it without a trace.
          if (isCollapsedSection(child)) {
            const name = renderInline(children).trim();
            ctx.diag.collapsedSections.push(name || '(untitled section)');
            out.push({
              type: 'paragraph',
              children: [
                {
                  type: 'em',
                  children: [
                    {
                      type: 'text',
                      value:
                        '(loopmark: this section is collapsed in Loop, so its content was ' +
                        'not in the page. Expand it and export again.)',
                    },
                  ],
                },
              ],
            });
          }
          break;
        }
        case 'list':
          out.push(...buildList(child, ctx));
          break;
        case 'table': {
          const table = buildTable(child, ctx);
          if (table) out.push(table);
          break;
        }
        case 'code':
          out.push(buildCode(child, ctx));
          break;
        case 'quote':
          out.push({
            type: 'quote',
            alert: calloutAlert(child),
            blocks: collectBlocks(child, ctx),
          });
          break;
        case 'break':
          out.push({ type: 'thematicBreak' });
          break;
        case 'component':
          out.push({
            type: 'component',
            kind: componentKind(child) ?? 'loop-component',
            blocks: collectBlocks(child, ctx),
          });
          break;
        case 'paragraph':
          out.push(...buildParagraph(child, ctx));
          break;
        case 'task': {
          const item: ListItem = {
            checked: checkedState(child) ?? false,
            blocks: collectBlocks(child, ctx),
          };
          // Loop renders standalone task items as siblings rather than inside
          // a <ul>, so merge each into the run of tasks already in progress.
          const previous = out[out.length - 1];
          if (previous && previous.type === 'list' && !previous.ordered) {
            previous.items.push(item);
          } else {
            out.push({ type: 'list', ordered: false, start: 1, items: [item] });
          }
          break;
        }
        case 'container': {
          const tag = child.tagName.toUpperCase();
          // A <span> demoted to a container because it hosts a block component
          // is a known Loop shape, not an element we failed to recognize.
          if (!KNOWN_CONTAINERS.has(tag) && !containsEmbeddedBlock(child)) {
            ctx.diag.unrecognizedElements += 1;
            const sample = tag.toLowerCase();
            if (!ctx.diag.unrecognizedSamples.includes(sample)) {
              ctx.diag.unrecognizedSamples.push(sample);
            }
          }
          out.push(...collectBlocks(child, ctx));
          break;
        }
      }
    }

    flush();
    return mergeAndNestLists(out);
  } finally {
    ctx.depth -= 1;
  }
}

type ListBlock = Extract<Block, { type: 'list' }>;

/** A list Loop produced: one item per `<ul>`, depth carried on the item. */
function isLoopList(block: Block): block is ListBlock {
  return (
    block.type === 'list' &&
    block.items.length > 0 &&
    block.items.every((item) => item.level !== undefined)
  );
}

/**
 * Fold Loop's flat run of single-item lists back into one nested list.
 *
 * Loop emits every list item as its own `<ul>` sibling, so a five-bullet list
 * arrives as five separate lists and renders with a blank line between each
 * bullet; sub-bullets lose their indentation entirely. Consecutive Loop lists
 * are merged, then `aria-level` is folded into real nesting.
 */
function mergeAndNestLists(blocks: Block[]): Block[] {
  const merged: Block[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (previous && isLoopList(previous) && isLoopList(block)) {
      previous.items.push(...block.items);
      continue;
    }
    merged.push(block);
  }
  return merged.map(nestLoopList);
}

/** Turn a flat, `level`-annotated item list into genuinely nested lists. */
function nestLoopList(block: Block): Block {
  if (!isLoopList(block)) return block;
  const items = block.items;
  const baseLevel = items[0]!.level ?? 1;
  if (!items.some((item) => (item.level ?? 1) > baseLevel)) return block;

  interface Frame {
    level: number;
    list: ListBlock;
  }
  const root: ListBlock = { type: 'list', ordered: block.ordered, start: block.start, items: [] };
  const stack: Frame[] = [{ level: baseLevel, list: root }];

  for (const item of items) {
    const level = item.level ?? baseLevel;
    while (stack.length > 1 && level < stack[stack.length - 1]!.level) stack.pop();

    let top = stack[stack.length - 1]!;
    if (level > top.level) {
      const parent = top.list.items[top.list.items.length - 1];
      const child: ListBlock = {
        type: 'list',
        ordered: item.ordered === true,
        start: item.position ?? 1,
        items: [],
      };
      // An item deeper than its predecessor with no predecessor to hang off
      // stays where it is rather than being dropped.
      if (parent) {
        parent.blocks.push(child);
        stack.push({ level, list: child });
        top = stack[stack.length - 1]!;
      }
    }
    top.list.items.push(item);
  }
  return root;
}

/**
 * Build a Loop paragraph block.
 *
 * A `scriptor-paragraph` wraps one or more `scriptor-line` child divs. Treating
 * each line as its own paragraph over-splits prose; concatenating them without
 * a separator silently joins words across lines ("endbegin"). We join them with
 * a Markdown hard break, which is correct for hard lines and harmless for soft
 * ones.
 */
export function buildParagraph(el: Element, ctx: Ctx): Block[] {
  const BLOCK_KINDS: Kind[] = ['list', 'table', 'code', 'quote', 'heading', 'component', 'task'];
  const kids = composedChildren(el).filter(isElement);

  // A paragraph that actually contains block content (a nested list, say) is
  // not a paragraph -- fall back to the generic walk.
  if (kids.some((kid) => BLOCK_KINDS.includes(classify(kid)))) {
    return collectBlocks(el, ctx);
  }

  const children: Inline[] = [];
  for (const kid of composedChildren(el)) {
    if (isElement(kid) && classify(kid) === 'container') {
      // Only break between lines that actually have content. Pretty-printed
      // markup puts a whitespace text node before the first line, and treating
      // that as content emits a leading stray hard break.
      if (inlineIsEmpty(children)) children.length = 0;
      else children.push({ type: 'break' });
      children.push(...inlineChildren(kid, ctx));
      continue;
    }
    children.push(...toInline(kid, ctx));
  }

  const trimmed = trimInline(children);
  if (trimmed.length === 0 || inlineIsEmpty(trimmed)) return [];
  if (trimmed.length === 1 && trimmed[0]!.type === 'image') {
    const img = trimmed[0] as Extract<Inline, { type: 'image' }>;
    return [{ type: 'image', alt: img.alt, src: img.src }];
  }
  return [{ type: 'paragraph', children: trimmed }];
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function listItemElements(listEl: Element): Element[] {
  /**
   * Loop associates list items with their list through `aria-owns` -- a
   * space-separated list of element IDs -- rather than DOM nesting. A
   * children-only walk finds an empty list. Loop also renders a duplicate
   * `aria-hidden` copy of those items, which `EXCLUDE_SELECTORS` drops so
   * they are not counted twice.
   */
  const owns = listEl.getAttribute('aria-owns');
  if (owns) {
    const owned: Element[] = [];
    for (const id of owns.split(/\s+/)) {
      const el = pierceGetElementById(listEl.ownerDocument ?? document, id);
      if (el && !excluded(el)) owned.push(el);
    }
    if (owned.length > 0) return owned;
  }

  const items: Element[] = [];
  for (const child of composedChildren(listEl)) {
    if (!isElement(child)) continue;
    if (SKIP_TAGS.has(child.tagName.toUpperCase()) || excluded(child)) continue;
    const role = (child.getAttribute('role') ?? '').toLowerCase();
    if (
      child.tagName.toUpperCase() === 'LI' ||
      role === 'listitem' ||
      TASK_CLASS_PATTERN.test(classOf(child))
    ) {
      items.push(child);
      continue;
    }
    // Some editors wrap each item in a positioning div. Look one level in.
    if (role === 'presentation' || role === 'none' || child.tagName.toUpperCase() === 'DIV') {
      items.push(...listItemElements(child));
    }
  }
  return items;
}

/** Checkbox state for a list item, or `null` when it is not a checklist item. */
function checkedState(el: Element): boolean | null {
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked === 'true') return true;
  if (ariaChecked === 'false') return false;

  const role = (el.getAttribute('role') ?? '').toLowerCase();
  if (role === 'checkbox') return false;

  // Depth-limited rather than a full subtree scan: the checkbox sits within a
  // couple of wrappers, and an unbounded search per list item would be
  // quadratic on a nested list.
  const search = (node: Element, depth: number): boolean | null => {
    if (depth > 3) return null;
    for (const child of composedChildren(node)) {
      if (!isElement(child)) continue;
      const tag = child.tagName.toUpperCase();
      if (tag === 'INPUT' && child.getAttribute('type') === 'checkbox') {
        return (child as HTMLInputElement).checked || child.hasAttribute('checked');
      }
      const nested = child.getAttribute('aria-checked');
      if (nested === 'true') return true;
      if (nested === 'false') return false;
      if ((child.getAttribute('role') ?? '').toLowerCase() === 'checkbox') return false;
      const deeper = search(child, depth + 1);
      if (deeper !== null) return deeper;
    }
    return null;
  };

  const found = search(el, 0);
  if (found !== null) return found;
  // A Loop task item with no discoverable checkbox is still a checklist item.
  return TASK_CLASS_PATTERN.test(classOf(el)) ? false : null;
}

/**
 * Build a list, promoting any heading-only item to a top-level heading.
 *
 * This is the `- ## Heading` fix: Loop marks headings up inside list items,
 * and a heading that renders as a bullet is the single most damaging artifact
 * of copy-paste today. Promoting splits the list around the heading, which is
 * what the author actually meant.
 */
/**
 * Read the marker Loop renders for a list item, e.g. `"\u2022 "` or `"a. "`.
 * Returns `null` for markup that is not Loop's.
 */
function loopListMarker(li: Element): string | null {
  const style = (li as HTMLElement).style;
  const raw = style?.getPropertyValue?.(LIST_MARKER_CSS_VAR) ?? '';
  const marker = raw.replace(/^\s*["']|["']\s*$/g, '').trim();
  return marker === '' ? null : marker;
}

function markerIsOrdered(marker: string | null): boolean {
  if (marker === null) return false;
  if (BULLET_MARKER_PATTERN.test(marker)) return false;
  return ORDERED_MARKER_PATTERN.test(marker);
}

function ariaNumber(el: Element, attr: string): number | undefined {
  const raw = el.getAttribute(attr);
  if (raw === null) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function buildList(listEl: Element, ctx: Ctx): Block[] {
  const ordered =
    listEl.tagName.toUpperCase() === 'OL' ||
    (listEl.getAttribute('role') ?? '').toLowerCase() === 'list' &&
      listEl.hasAttribute('start');
  const startAttr = parseInt(listEl.getAttribute('start') ?? '1', 10);
  const start = Number.isFinite(startAttr) && startAttr > 0 ? startAttr : 1;

  const out: Block[] = [];
  let bucket: ListItem[] = [];

  const flushBucket = (): void => {
    if (bucket.length === 0) return;
    const first = bucket[0]!;
    out.push({
      type: 'list',
      ordered: ordered || first.ordered === true,
      start: first.position ?? start,
      items: bucket,
    });
    bucket = [];
  };

  for (const itemEl of listItemElements(listEl)) {
    // The list item IS a heading.
    if ((itemEl.getAttribute('role') ?? '').toLowerCase() === 'heading') {
      flushBucket();
      out.push({
        type: 'heading',
        level: headingLevel(itemEl),
        children: trimInline(inlineChildren(itemEl, ctx)),
      });
      continue;
    }

    const blocks = collectBlocks(itemEl, ctx);
    if (blocks.length === 0) continue;

    // The list item CONTAINS nothing but a heading.
    if (blocks.length === 1 && blocks[0]!.type === 'heading') {
      flushBucket();
      out.push(blocks[0]!);
      continue;
    }

    const marker = loopListMarker(itemEl);
    const item: ListItem = { checked: checkedState(itemEl), blocks };
    const level = ariaNumber(itemEl, 'aria-level');
    if (level !== undefined) item.level = level;
    if (marker !== null) item.ordered = markerIsOrdered(marker);
    const position = ariaNumber(itemEl, 'aria-posinset');
    if (position !== undefined) item.position = position;
    bucket.push(item);
  }

  flushBucket();

  // Never swallow a list whose items we failed to recognize -- degraded
  // output beats missing output.
  if (out.length === 0) return collectBlocks(listEl, ctx);
  return out;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function tableRows(el: Element): Element[] {
  const rows: Element[] = [];
  const visit = (node: Node): void => {
    for (const child of composedChildren(node)) {
      if (!isElement(child)) continue;
      if (SKIP_TAGS.has(child.tagName.toUpperCase()) || excluded(child)) continue;
      const tag = child.tagName.toUpperCase();
      const role = (child.getAttribute('role') ?? '').toLowerCase();
      if (tag === 'TR' || role === 'row' || TABLE_ROW_CLASS_PATTERN.test(classOf(child))) {
        rows.push(child);
        continue;
      }
      visit(child);
    }
  };
  visit(el);
  return rows;
}

function rowCells(row: Element): Element[] {
  const cells: Element[] = [];
  const visit = (node: Node): void => {
    for (const child of composedChildren(node)) {
      if (!isElement(child)) continue;
      if (SKIP_TAGS.has(child.tagName.toUpperCase()) || excluded(child)) continue;
      const tag = child.tagName.toUpperCase();
      const role = (child.getAttribute('role') ?? '').toLowerCase();
      if (
        tag === 'TD' || tag === 'TH' ||
        role === 'cell' || role === 'gridcell' ||
        role === 'columnheader' || role === 'rowheader' ||
        TABLE_CELL_CLASS_PATTERN.test(classOf(child))
      ) {
        cells.push(child);
        continue;
      }
      visit(child);
    }
  };
  visit(row);
  return cells;
}

function isHeaderRow(row: Element): boolean {
  const cells = rowCells(row);
  if (cells.length === 0) return false;
  return cells.every((c) => {
    const role = (c.getAttribute('role') ?? '').toLowerCase();
    return c.tagName.toUpperCase() === 'TH' || role === 'columnheader';
  });
}

/**
 * Flatten block content back down to inline nodes for a table cell.
 *
 * GFM pipe tables cannot contain block structure, but a Loop cell routinely
 * holds several paragraphs, or a bulleted list. Running the full block
 * pipeline and then joining with hard breaks keeps those boundaries visible:
 * `renderCell` turns each `break` into a `<br>`, which every GFM renderer
 * honours inside a cell.
 */
function blocksToInline(blocks: Block[]): Inline[] {
  const out: Inline[] = [];
  const push = (nodes: Inline[]): void => {
    const trimmed = trimInline(nodes);
    if (trimmed.length === 0) return;
    if (out.length > 0) out.push({ type: 'break' });
    out.push(...trimmed);
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        push(block.children);
        break;
      case 'list':
        for (const item of block.items) {
          const box = item.checked === null ? '' : item.checked ? '[x] ' : '[ ] ';
          push([{ type: 'text', value: `• ${box}` }, ...blocksToInline(item.blocks)]);
        }
        break;
      case 'code':
        // Newlines would terminate the table row, so the snippet becomes
        // single-line inline code.
        push([{ type: 'code', value: block.value.replace(/\s+/g, ' ').trim() }]);
        break;
      case 'quote':
      case 'component':
        push(blocksToInline(block.blocks));
        break;
      case 'image':
        push([{ type: 'image', alt: block.alt, src: block.src }]);
        break;
      case 'table':
        push([{ type: 'text', value: '(nested table omitted)' }]);
        break;
      case 'thematicBreak':
        break;
    }
  }
  return out;
}

/** A table nested inside a table cell is flattened rather than recursed into. */
const MAX_TABLE_DEPTH = 3;

function cellInline(cell: Element, ctx: Ctx): Inline[] {
  return trimInline(blocksToInline(collectBlocks(cell, ctx)));
}

export function buildTable(el: Element, ctx: Ctx): Block | null {
  if (ctx.tableDepth >= MAX_TABLE_DEPTH) return null;
  const rows = tableRows(el);
  if (rows.length === 0) return null;

  ctx.tableDepth += 1;
  try {
    return buildTableRows(rows, ctx);
  } finally {
    ctx.tableDepth -= 1;
  }
}

function buildTableRows(rows: Element[], ctx: Ctx): Block | null {
  const grid = rows.map((row) => rowCells(row).map((cell) => cellInline(cell, ctx)));
  const nonEmpty = grid.filter((r) => r.length > 0);
  if (nonEmpty.length === 0) return null;

  // GFM requires a header row. If the markup does not designate one, the
  // first row serves -- the near-universal convention, and better than
  // emitting an empty header that renders as a blank band.
  let header: Inline[][];
  let body: Inline[][][];
  if (rows[0] && isHeaderRow(rows[0]) && nonEmpty.length >= 1) {
    header = nonEmpty[0]!;
    body = nonEmpty.slice(1);
  } else {
    header = nonEmpty[0]!;
    body = nonEmpty.slice(1);
  }

  // Ragged rows: pad every row out to the widest, so the pipe table stays valid.
  const width = Math.max(header.length, ...body.map((r) => r.length), 1);
  const pad = (row: Inline[][]): Inline[][] => {
    const copy = row.slice(0, width);
    while (copy.length < width) copy.push([]);
    return copy;
  };

  return { type: 'table', header: pad(header), rows: body.map(pad) };
}

// ---------------------------------------------------------------------------
// Code blocks
// ---------------------------------------------------------------------------

function detectLanguage(el: Element): string | null {
  // Loop puts the language on a combobox button in the block's toolbar rather
  // than on a class, so this is checked before the conventional hooks.
  const combo = el.querySelector(CODE_LANGUAGE_SELECTOR);
  if (combo) {
    const name = (combo.textContent ?? '').trim().toLowerCase();
    if (name) {
      const alias = CODE_LANGUAGE_ALIASES[name];
      const lang = alias === undefined ? name : alias;
      return lang === '' ? null : lang;
    }
  }

  const candidates = [el, ...Array.from(el.querySelectorAll('code'))];
  for (const node of candidates) {
    const explicit = node.getAttribute('data-language') ?? node.getAttribute('lang');
    if (explicit) return explicit.toLowerCase();
    const cls = typeof node.className === 'string' ? node.className : '';
    const m = /(?:language|lang|highlight)[-_]([a-z0-9+#]+)/i.exec(cls);
    if (m?.[1]) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Remove the indentation the surrounding HTML added, without disturbing the
 * code's own relative indentation.
 */
export function dedent(value: string): string {
  const lines = value.split('\n');
  let common: string | null = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = /^[ \t]*/.exec(line)![0];
    if (common === null) {
      common = indent;
      continue;
    }
    let i = 0;
    while (i < common.length && i < indent.length && common[i] === indent[i]) i += 1;
    common = common.slice(0, i);
  }
  if (!common) return value;
  return lines.map((line) => (line.startsWith(common!) ? line.slice(common!.length) : line)).join('\n');
}

export function buildCode(el: Element, ctx?: Ctx): Block {
  const lang = detectLanguage(el);

  // Strip the block's own chrome before reading its text. Loop renders a
  // language chip, a line-number gutter and "Go to line" / "Show more lines"
  // controls inside the block, all of which otherwise end up in the fence.
  const source = codeTextOf(el);

  // Deliberately NOT collapsing whitespace: it is the entire point of a code block.
  let value = source.replace(/\r\n?/g, '\n');
  value = dedent(value.replace(/^\n+/, '').replace(/[ \t]+$/gm, '')).replace(/\s+$/, '');

  if (value === '') {
    // Loop virtualizes long snippets: until "Show more lines" is clicked the
    // code simply is not in the DOM. Saying so beats emitting an empty fence
    // that reads as an intentionally blank code block.
    const label = lang ? `${lang} ` : '';
    ctx?.diag.warnings.push(
      `A ${label ? `${lang} ` : ''}code block was collapsed or virtualized and could not be read.`,
    );
    return {
      type: 'code',
      lang,
      value: `[loopmark: this ${label}code block was collapsed in the page and could not be read]`,
    };
  }

  return { type: 'code', lang, value };
}

/**
 * Is this element laid out as a block, and therefore a line boundary?
 *
 * Asks the computed style rather than matching class names, because Loop's
 * code-line elements carry hashed CSS-module names that change every build.
 * jsdom reports no `display` for elements it has no UA rule for, hence the
 * tag-name fallback.
 */
function isBlockLevel(el: Element): boolean {
  let display = '';
  try {
    display = getComputedStyle(el).display;
  } catch {
    display = '';
  }
  if (display) {
    return !(display === 'inline' || display === 'contents' || display.startsWith('inline-'));
  }
  return !INLINE_TAGS.has(el.tagName.toUpperCase());
}

/**
 * Text of a code block, with its editor chrome removed and its line structure
 * restored.
 *
 * Loop renders every line of a snippet as its own element and puts no newline
 * characters anywhere in the DOM -- the line breaks exist purely as layout.
 * Concatenating text nodes therefore yields the whole program on one line,
 * indentation and all collapsed away. A newline is emitted at each block-level
 * boundary to put them back.
 *
 * VERIFIED 2026-09-16 against a live Loop page.
 */
function codeTextOf(el: Element): string {
  let chrome: Element[] = [];
  try {
    chrome = Array.from(el.querySelectorAll(CODE_CHROME_SELECTOR));
  } catch {
    chrome = [];
  }

  const skip = new Set(chrome);
  const parts: string[] = [];

  /** Never stack blank lines from nested block wrappers around one line. */
  const breakLine = (): void => {
    if (parts.length === 0) return;
    if (/\n[ \t]*$/.test(parts[parts.length - 1] ?? '')) return;
    parts.push('\n');
  };

  const visit = (node: Node): void => {
    if (isText(node)) {
      const value = node.nodeValue ?? '';
      // Whitespace containing a newline is HTML source formatting between
      // block elements, not code. A blank line in the snippet arrives as an
      // empty line element, never as a text node, so this cannot eat one.
      if (value.trim() === '' && /\n/.test(value)) return;
      // Loop indents with non-breaking spaces, which must survive as spaces
      // rather than as U+00A0 inside a fenced block.
      parts.push(value.replace(/\u00a0/g, ' '));
      return;
    }
    if (!isElement(node)) return;
    if (skip.has(node)) return;
    if (node.tagName.toUpperCase() === 'BR') {
      parts.push('\n');
      return;
    }

    const block = isBlockLevel(node);
    if (!block) {
      for (const child of composedChildren(node)) visit(child);
      return;
    }

    breakLine();
    const before = parts.length;
    for (const child of composedChildren(node)) visit(child);
    if (parts.length === before) {
      // A block that emitted nothing is an empty line in the source. It needs
      // a newline of its own, because `breakLine` would collapse it into the
      // break that already ended the previous line.
      parts.push('\n');
    }
    breakLine();
  };

  visit(el);
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

/**
 * Escape characters that would otherwise be read as Markdown syntax.
 *
 * Intentionally conservative. Over-escaping produces output littered with
 * backslashes, which is worse for the primary use case (pasting into an LLM)
 * than the occasional stray asterisk.
 */
export function escapeText(value: string): string {
  return value
    .replace(/([\\`*_[\]])/g, '\\$1')
    // Only escape `<` when it could start a tag or comment.
    .replace(/<(?=[a-zA-Z/!?])/g, '\\<')
    // Only escape `&` when it could start an entity.
    .replace(/&(?=[a-zA-Z#][a-zA-Z0-9]*;)/g, '\\&');
}

/** Escape line-leading characters that would start a different block type. */
function escapeLineStarts(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^(\s*)([#>+-]|\d+[.)])(\s)/, '$1\\$2$3'))
    .join('\n');
}

/** Wrap `body` in `mark`, hoisting surrounding whitespace outside the delimiters. */
function wrapMark(body: string, mark: string): string {
  if (body.trim() === '') return body;
  const lead = /^\s*/.exec(body)![0];
  const trail = /\s*$/.exec(body)![0];
  return `${lead}${mark}${body.slice(lead.length, body.length - trail.length)}${mark}${trail}`;
}

/** Backtick fence long enough to contain `value` unambiguously. */
function codeFence(value: string, min = 1): string {
  let longest = 0;
  for (const run of value.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(min, longest + 1));
}

function encodeUrl(url: string): string {
  // Parentheses are the only characters that can terminate a Markdown
  // destination early. Leave everything else untouched -- being faithful to
  // the original URL matters more than being pretty.
  return url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
}

export function renderInline(nodes: Inline[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += escapeText(node.value);
        break;
      case 'code': {
        const value = node.value.trim();
        const fence = codeFence(value);
        const padded = /^`|`$/.test(value) ? ` ${value} ` : value;
        out += `${fence}${padded}${fence}`;
        break;
      }
      case 'strong':
        out += wrapMark(renderInline(node.children), '**');
        break;
      case 'em':
        // Underscore rather than asterisk so nesting inside `**` cannot
        // produce a run of three-plus asterisks that parsers disagree about.
        out += wrapMark(renderInline(node.children), '_');
        break;
      case 'del':
        out += wrapMark(renderInline(node.children), '~~');
        break;
      case 'link': {
        const text = renderInline(node.children).trim();
        out += text ? `[${text}](${encodeUrl(node.href)})` : encodeUrl(node.href);
        break;
      }
      case 'image':
        out += `![${escapeText(node.alt)}](${encodeUrl(node.src)})`;
        break;
      case 'break':
        // Backslash-newline is a GFM hard break that survives trailing-
        // whitespace trimming, unlike the two-space form.
        out += '\\\n';
        break;
      case 'mention':
        out += escapeText(node.name);
        break;
    }
  }
  return out.replace(/[ \t]+/g, ' ').replace(/ ?\\\n ?/g, '\\\n');
}

function renderCell(nodes: Inline[]): string {
  return renderInline(nodes)
    .replace(/\|/g, '\\|')
    .replace(/\\\n/g, '<br>')
    .replace(/\n/g, ' ')
    .trim();
}

function indentLines(text: string, prefix: string, firstPrefix = prefix): string {
  const lines = text.split('\n');
  return lines
    .map((line, i) => {
      const p = i === 0 ? firstPrefix : prefix;
      return line === '' ? p.replace(/\s+$/, '') : p + line;
    })
    .join('\n');
}

export function renderBlocks(blocks: Block[], tight = false): string {
  const parts: string[] = [];
  const kinds: Block['type'][] = [];
  const push = (text: string, type: Block['type']): void => {
    parts.push(text);
    kinds.push(type);
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const text = renderInline(block.children).replace(/\n/g, ' ').trim();
        if (text) push(`${'#'.repeat(block.level)} ${text}`, 'heading');
        break;
      }
      case 'paragraph': {
        const text = escapeLineStarts(renderInline(block.children).trim());
        if (text) push(text, 'paragraph');
        break;
      }
      case 'thematicBreak':
        push('---', 'thematicBreak');
        break;
      case 'image':
        push(`![${escapeText(block.alt)}](${encodeUrl(block.src)})`, 'image');
        break;
      case 'code': {
        const fence = '`'.repeat(Math.max(3, longestBacktickRun(block.value) + 1));
        push(`${fence}${block.lang ?? ''}\n${block.value}\n${fence}`, 'code');
        break;
      }
      case 'quote': {
        const inner = renderBlocks(block.blocks);
        const lead = block.alert ? `> [!${block.alert}]\n` : '';
        push(
          lead +
            inner
              .split('\n')
              .map((line) => (line === '' ? '>' : `> ${line}`))
              .join('\n'),
          'quote',
        );
        break;
      }
      case 'component': {
        const inner = renderBlocks(block.blocks);
        const fence = '`'.repeat(Math.max(4, longestBacktickRun(inner) + 1));
        push(
          `<!-- loopmark: live Loop component, captured as a static snapshot -->\n` +
            `${fence}${block.kind}\n${inner}\n${fence}`,
          'component',
        );
        break;
      }
      case 'table': {
        const cols = block.header.length;
        const head = `| ${block.header.map(renderCell).join(' | ')} |`;
        const rule = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
        const body = block.rows.map((row) => `| ${row.map(renderCell).join(' | ')} |`);
        push([head, rule, ...body].join('\n'), 'table');
        break;
      }
      case 'list': {
        const lines: string[] = [];
        block.items.forEach((item, index) => {
          const marker = block.ordered ? `${block.start + index}.` : '-';
          const box = item.checked === null ? '' : item.checked ? '[x] ' : '[ ] ';
          const body = renderBlocks(item.blocks, true);
          const firstPrefix = `${marker} ${box}`;
          // Continuation lines align under the text, not the marker, so nested
          // lists and multi-paragraph items stay inside the item.
          const contPrefix = ' '.repeat(firstPrefix.length);
          lines.push(indentLines(body, contPrefix, firstPrefix));
        });
        push(lines.join('\n'), 'list');
        break;
      }
    }
  }

  // Inside a list item, a nested list hugging its parent text keeps the list
  // "tight" -- GFM renders a blank line there as <p>-wrapped item content.
  let out = '';
  parts.forEach((text, i) => {
    if (i > 0) out += tight && kinds[i] === 'list' && kinds[i - 1] === 'paragraph' ? '\n' : '\n\n';
    out += text;
  });
  return out;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const run of value.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

// ---------------------------------------------------------------------------
// Top-level conversion
// ---------------------------------------------------------------------------

/**
 * Compare what the page contains with what was converted.
 *
 * Loop virtualizes off-screen blocks: a table or code block outside the
 * viewport may be `hidden`, or present only as its chrome. `forceRender`
 * scrolls the page to defeat that, but it is best-effort, so a shortfall is
 * reported rather than passed off as a complete export.
 */
function warnOnMissingComponents(
  root: Element,
  blocks: Block[],
  diagnostics: Diagnostics,
): void {
  const emitted = { table: 0, code: 0 };
  const count = (list: Block[]): void => {
    for (const block of list) {
      if (block.type === 'table') emitted.table += 1;
      else if (block.type === 'code') emitted.code += 1;
      else if (block.type === 'quote' || block.type === 'component') count(block.blocks);
      else if (block.type === 'list') for (const item of block.items) count(item.blocks);
    }
  };
  count(blocks);

  const present = {
    table: safeCount(root, TABLE_COUNT_SELECTOR),
    code: safeCount(root, '.scriptor-component-code-block'),
  };

  const collapsed = diagnostics.collapsedSections;
  for (const kind of ['table', 'code'] as const) {
    const missing = present[kind] - emitted[kind];
    if (missing === 0) continue;

    // Naming the sections turns "something is missing" into an instruction.
    const because =
      collapsed.length > 0
        ? `They are inside these collapsed sections: ${collapsed.join('; ')}. ` +
          `Expand them in Loop and run loopmark again.`
        : `Loop had most likely not rendered them. Scroll the whole page and run ` +
          `loopmark again.`;
    diagnostics.warnings.push(
      `${missing} of ${present[kind]} ${kind} block(s) could not be read. ${because}`,
    );
  }
}

function safeCount(root: Element, selector: string): number {
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

/** Deepest heading Markdown has; `####### x` is a paragraph, not a heading. */
const MAX_HEADING_LEVEL = 6;

/**
 * Push every heading down by `by` levels, so the title can own H1.
 *
 * Loop tops out at `aria-level="4"` in practice, so the clamp is rarely
 * reached. When it is, two adjacent Loop levels collapse into one Markdown
 * level -- a flatter outline, which beats emitting `#######`, which renders as
 * literal text.
 */
function shiftHeadings(blocks: Block[], by: number): Block[] {
  return blocks.map((block) => {
    switch (block.type) {
      case 'heading': {
        const level = Math.min(block.level + by, MAX_HEADING_LEVEL) as HeadingLevel;
        return { ...block, level };
      }
      case 'quote':
      case 'component':
        return { ...block, blocks: shiftHeadings(block.blocks, by) };
      case 'list':
        return {
          ...block,
          items: block.items.map((item) => ({ ...item, blocks: shiftHeadings(item.blocks, by) })),
        };
      default:
        return block;
    }
  });
}

export interface ConvertInput {
  root: Element;
  meta: DocMeta;
  diagnostics: Diagnostics;
}

export function convert({ root, meta, diagnostics }: ConvertInput): ConversionResult {
  const ctx: Ctx = { diag: diagnostics, imageUrls: [], depth: 0, tableDepth: 0 };
  const blocks = collectBlocks(root, ctx);
  const doc: LoopDoc = { meta, blocks };

  // The page title becomes the document's only H1, so the body nests beneath
  // it. Done here rather than in `headingLevel` on purpose: the IR keeps the
  // level Loop actually used, and the shift is a property of assembling a
  // document that has a title, not of reading a heading.
  let markdown =
    `# ${meta.title.replace(/\n/g, ' ').trim() || 'Untitled'}\n\n` +
    renderBlocks(shiftHeadings(blocks, 1));

  warnOnMissingComponents(root, blocks, diagnostics);

  const uniqueImages = Array.from(new Set(ctx.imageUrls));
  if (uniqueImages.length > 0) {
    markdown +=
      `\n\n---\n\n<!-- loopmark: ${uniqueImages.length} image(s) below are links to Loop-hosted ` +
      `files. They are access-controlled and will not render outside an authenticated session. -->\n\n` +
      `**Images referenced in this page**\n\n` +
      uniqueImages.map((url, i) => `${i + 1}. <${url}>`).join('\n');
  }

  // Provenance as an HTML comment so it survives rendering without adding noise.
  markdown +=
    `\n\n<!-- Exported from Microsoft Loop by loopmark on ${meta.exportedAt}\n` +
    `     Title:  ${meta.title.replace(/--+/g, '-')}\n` +
    `     Source: ${meta.url.replace(/--+/g, '-')}\n` +
    `     loopmark reads rendered DOM; it is not a Loop API and may be incomplete. -->\n`;

  // Collapse any run of 3+ newlines introduced by empty blocks.
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  return { markdown, doc, diagnostics, imageUrls: uniqueImages };
}

/** Convenience wrapper used by tests: convert an element with default metadata. */
export function convertElement(root: Element, meta?: Partial<DocMeta>): ConversionResult {
  const diagnostics: Diagnostics = {
    contentRootStrategy: 'test',
    shadowRootsPierced: 0,
    unrecognizedElements: 0,
    unrecognizedSamples: [],
    expandedWidgets: 0,
    elementsVisited: 0,
    droppedDataImages: 0,
    collapsedSections: [],
    warnings: [],
  };
  return convert({
    root,
    meta: {
      title: meta?.title ?? 'Test Page',
      url: meta?.url ?? 'https://example.invalid/page',
      exportedAt: meta?.exportedAt ?? '1970-01-01T00:00:00.000Z',
    },
    diagnostics,
  });
}
