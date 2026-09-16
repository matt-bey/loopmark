/**
 * HTML -> GitHub-flavored Markdown.
 *
 * Two halves, deliberately separable:
 *   1. `domToBlocks` walks the composed DOM and produces the `Block[]` IR.
 *   2. `renderBlocks` turns that IR into Markdown text.
 *
 * No dependencies, at build time or run time.
 */

import { composedChildren, composedText } from './acquire.js';
import {
  CALLOUT_PATTERNS,
  COMPONENT_SELECTORS,
  EXCLUDE_SELECTORS,
  MENTION_SELECTORS,
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

const attrBag = (el: Element): string =>
  [
    typeof el.className === 'string' ? el.className : '',
    el.getAttribute('data-testid') ?? '',
    el.getAttribute('data-callout-type') ?? '',
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

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK']);

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
  | 'container';

function classify(el: Element): Kind {
  const tag = el.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag)) return 'skip';
  if (excluded(el)) return 'skip';

  const role = (el.getAttribute('role') ?? '').toLowerCase();

  // Headings first, and by ARIA before tag name. This is the fix for Loop
  // emitting headings as list items: role wins over ancestry.
  if (role === 'heading' || /^H[1-6]$/.test(tag)) return 'heading';

  if (componentKind(el)) return 'component';
  if (isMention(el)) return 'inline';

  if (tag === 'PRE') return 'code';
  if (tag === 'HR' || role === 'separator') return 'break';
  if (tag === 'TABLE' || role === 'table' || role === 'grid') return 'table';
  if (tag === 'UL' || tag === 'OL' || tag === 'MENU' || role === 'list') return 'list';
  if (tag === 'BLOCKQUOTE' || role === 'note' || isCalloutish(el)) return 'quote';

  if (INLINE_TAGS.has(tag)) return 'inline';
  return 'container';
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
  return 3; // A heading of unknown rank is more likely a subsection than a title.
}

// ---------------------------------------------------------------------------
// Inline conversion
// ---------------------------------------------------------------------------

function styleSaysBold(el: Element): boolean {
  const inline = (el as HTMLElement).style?.fontWeight ?? '';
  if (/^(bold|bolder|[6-9]00)$/.test(inline)) return true;
  try {
    const w = getComputedStyle(el).fontWeight;
    return /^(bold|bolder|[6-9]00)$/.test(w);
  } catch {
    return false;
  }
}

function styleSaysItalic(el: Element): boolean {
  const inline = (el as HTMLElement).style?.fontStyle ?? '';
  if (inline === 'italic' || inline === 'oblique') return true;
  try {
    return /italic|oblique/.test(getComputedStyle(el).fontStyle);
  } catch {
    return false;
  }
}

function styleSaysStrike(el: Element): boolean {
  const inline = (el as HTMLElement).style?.textDecoration ?? '';
  if (/line-through/.test(inline)) return true;
  try {
    return /line-through/.test(getComputedStyle(el).textDecorationLine || getComputedStyle(el).textDecoration);
  } catch {
    return false;
  }
}

interface Ctx {
  diag: Diagnostics;
  imageUrls: string[];
  /** Depth guard -- a malformed or cyclic composed tree must not blow the stack. */
  depth: number;
}

const MAX_DEPTH = 120;

/** Convert the children of `el` to inline nodes. */
function inlineChildren(el: Node, ctx: Ctx): Inline[] {
  const out: Inline[] = [];
  for (const child of composedChildren(el)) out.push(...toInline(child, ctx));
  return out;
}

function toInline(node: Node, ctx: Ctx): Inline[] {
  if (ctx.depth > MAX_DEPTH) return [];

  if (isText(node)) {
    const value = (node.nodeValue ?? '').replace(/\s+/g, ' ');
    return value ? [{ type: 'text', value }] : [];
  }
  if (!isElement(node)) return [];

  const tag = node.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag) || excluded(node)) return [];

  ctx.depth += 1;
  try {
    if (tag === 'BR') return [{ type: 'break' }];

    if (tag === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      const alt = node.getAttribute('alt') ?? '';
      if (src) ctx.imageUrls.push(src);
      return src ? [{ type: 'image', alt, src }] : [];
    }

    if (isMention(node)) {
      const name = composedText(node).replace(/\s+/g, ' ').trim();
      return name ? [{ type: 'mention', name }] : [];
    }

    if (tag === 'A') {
      const href = node.getAttribute('href') ?? '';
      const children = inlineChildren(node, ctx);
      if (!href || children.length === 0) return children;
      return [{ type: 'link', href, children }];
    }

    if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') {
      const value = composedText(node).replace(/\s+/g, ' ').trim();
      return value ? [{ type: 'code', value }] : [];
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
    if (n.type === 'break') return false;
    return !inlineIsEmpty(n.children);
  });
}

function trimInline(nodes: Inline[]): Inline[] {
  const out = nodes.slice();
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
        case 'heading':
          out.push({
            type: 'heading',
            level: headingLevel(child),
            children: trimInline(inlineChildren(child, ctx)),
          });
          break;
        case 'list':
          out.push(...buildList(child, ctx));
          break;
        case 'table': {
          const table = buildTable(child, ctx);
          if (table) out.push(table);
          break;
        }
        case 'code':
          out.push(buildCode(child));
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
        case 'container': {
          const tag = child.tagName.toUpperCase();
          if (!KNOWN_CONTAINERS.has(tag)) {
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
    return out;
  } finally {
    ctx.depth -= 1;
  }
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function listItemElements(listEl: Element): Element[] {
  const items: Element[] = [];
  for (const child of composedChildren(listEl)) {
    if (!isElement(child)) continue;
    if (SKIP_TAGS.has(child.tagName.toUpperCase()) || excluded(child)) continue;
    const role = (child.getAttribute('role') ?? '').toLowerCase();
    if (child.tagName.toUpperCase() === 'LI' || role === 'listitem') {
      items.push(child);
      continue;
    }
    // Some editors wrap each <li> in a positioning div. Look one level in.
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

  for (const child of composedChildren(el)) {
    if (!isElement(child)) continue;
    const tag = child.tagName.toUpperCase();
    if (tag === 'INPUT' && child.getAttribute('type') === 'checkbox') {
      return (child as HTMLInputElement).checked || child.hasAttribute('checked');
    }
    const nested = child.getAttribute('aria-checked');
    if (nested === 'true') return true;
    if (nested === 'false') return false;
    if ((child.getAttribute('role') ?? '').toLowerCase() === 'checkbox') return false;
  }
  return null;
}

/**
 * Build a list, promoting any heading-only item to a top-level heading.
 *
 * This is the `- ## Heading` fix: Loop marks headings up inside list items,
 * and a heading that renders as a bullet is the single most damaging artifact
 * of copy-paste today. Promoting splits the list around the heading, which is
 * what the author actually meant.
 */
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
    out.push({ type: 'list', ordered, start, items: bucket });
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

    bucket.push({ checked: checkedState(itemEl), blocks });
  }

  flushBucket();
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
      if (tag === 'TR' || role === 'row') {
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
      if (tag === 'TD' || tag === 'TH' || role === 'cell' || role === 'gridcell' || role === 'columnheader' || role === 'rowheader') {
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

export function buildTable(el: Element, ctx: Ctx): Block | null {
  const rows = tableRows(el);
  if (rows.length === 0) return null;

  const grid = rows.map((row) => rowCells(row).map((cell) => trimInline(inlineChildren(cell, ctx))));
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

export function buildCode(el: Element): Block {
  // Deliberately NOT collapsing whitespace: it is the entire point of a code block.
  let value = composedText(el).replace(/\r\n?/g, '\n');
  value = value.replace(/^\n+/, '').replace(/\s+$/, '');
  return { type: 'code', lang: detectLanguage(el), value };
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
        const fence = codeFence(node.value);
        const padded = /^`|`$/.test(node.value) ? ` ${node.value} ` : node.value;
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

export interface ConvertInput {
  root: Element;
  meta: DocMeta;
  diagnostics: Diagnostics;
}

export function convert({ root, meta, diagnostics }: ConvertInput): ConversionResult {
  const ctx: Ctx = { diag: diagnostics, imageUrls: [], depth: 0 };
  const blocks = collectBlocks(root, ctx);
  const doc: LoopDoc = { meta, blocks };

  let markdown = `# ${meta.title.replace(/\n/g, ' ').trim() || 'Untitled'}\n\n${renderBlocks(blocks)}`;

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
