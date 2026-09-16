/**
 * loopmark intermediate representation.
 *
 * The pipeline is DOM -> IR -> Markdown rather than DOM -> Markdown so that
 * structural decisions ("this is a level-2 heading") are testable independently
 * of rendering decisions ("a level-2 heading is `## `").
 */

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

export type Inline =
  | { type: 'text'; value: string }
  /** Inline code. Rendered with the minimum backtick fence that is unambiguous. */
  | { type: 'code'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'del'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'image'; alt: string; src: string }
  /** A hard line break inside a paragraph (`<br>`), rendered as backslash-newline. */
  | { type: 'break' }
  /** An @mention or person chip, flattened to the display name. */
  | { type: 'mention'; name: string };

// ---------------------------------------------------------------------------
// Block content
// ---------------------------------------------------------------------------

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** GitHub Alert kinds. Loop callouts are mapped onto these when detectable. */
export type AlertKind = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

export interface ListItem {
  /** `null` when the item is not a checklist item. */
  checked: boolean | null;
  /** Item content. Nested lists appear here as nested `list` blocks. */
  blocks: Block[];
}

export type Block =
  | { type: 'heading'; level: HeadingLevel; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'code'; lang: string | null; value: string }
  | { type: 'quote'; alert: AlertKind | null; blocks: Block[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'thematicBreak' }
  /**
   * A live Loop component (task list, voting table, progress tracker, ...)
   * captured as a static snapshot. `kind` is the best-effort component name.
   */
  | { type: 'component'; kind: string; blocks: Block[] }
  /** A block-level image, i.e. an image that is the only thing in its container. */
  | { type: 'image'; alt: string; src: string };

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface DocMeta {
  title: string;
  /** Page URL at export time. May contain tenant identifiers -- shown, never sent. */
  url: string;
  exportedAt: string;
}

export interface LoopDoc {
  meta: DocMeta;
  blocks: Block[];
}

// ---------------------------------------------------------------------------
// Diagnostics -- surfaced in the overlay's "Details" disclosure so that bug
// reports are actionable without the reporter needing to open devtools.
// ---------------------------------------------------------------------------

export interface Diagnostics {
  /** Which `findContentRoot` strategy matched, by name. */
  contentRootStrategy: string;
  /** How many open shadow roots the walker descended into. */
  shadowRootsPierced: number;
  /** Elements the converter did not recognize and rendered as plain text. */
  unrecognizedElements: number;
  /** Tag names of unrecognized elements, deduped, for selector triage. */
  unrecognizedSamples: string[];
  /** Disclosure widgets expanded during preparation. */
  expandedWidgets: number;
  /** Total elements visited in the composed-tree walk. */
  elementsVisited: number;
  /** Non-fatal problems worth telling the user about. */
  warnings: string[];
}

export interface ConversionResult {
  markdown: string;
  doc: LoopDoc;
  diagnostics: Diagnostics;
  /** Image URLs collected during conversion, for the auth-gated-images footnote. */
  imageUrls: string[];
}
