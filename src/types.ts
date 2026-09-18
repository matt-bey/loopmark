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
  | { type: 'mention'; name: string }
  /** A LaTeX equation, rendered as `$...$` or `$$...$$`. */
  | { type: 'math'; value: string; display: boolean }
  /**
   * A GFM footnote reference, e.g. `[^c1]`, marking the point a Loop comment
   * thread was attached to. Carries only the label: the thread itself is held
   * on the document, so a reference costs one token in the text flow and the
   * conversation lands at the bottom where it cannot interrupt the reading.
   */
  | { type: 'footnoteRef'; label: string };

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
  /**
   * Nesting depth from `aria-level`, 1-based. Loop never nests lists in the
   * DOM -- every item is its own single-item `<ul>` -- so depth arrives as a
   * flat annotation and is folded into real nesting after collection.
   */
  level?: number;
  /** Whether this item's own list is numbered, from its rendered marker. */
  ordered?: boolean;
  /** This item's position within its own list, from `aria-posinset`. */
  position?: number;
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
// Comments
// ---------------------------------------------------------------------------

/**
 * One message in a Loop comment thread.
 *
 * `blocks` rather than a string because a Loop comment body is itself a
 * miniature Scriptor document -- it can contain bold, links, lists and
 * @mentions, and it is converted by the same pipeline as the page.
 */
export interface CommentMessage {
  author: string;
  /**
   * What Loop displayed, which is a RELATIVE time ("43min ago"). Loop exposes
   * no absolute timestamp in the DOM, so this is only meaningful alongside the
   * export time recorded in `DocMeta.exportedAt`. `null` when unreadable.
   */
  timestamp: string | null;
  blocks: Block[];
}

export interface CommentThread {
  /** Loop's own thread id, so a re-export labels the same thread the same way. */
  id: string;
  /** Footnote label, e.g. `c1`. Assigned in document order. */
  label: string;
  /** Messages actually present in the DOM. See `hiddenReplies`. */
  messages: CommentMessage[];
  /**
   * Replies Loop counted but did not render. The gutter shows only the
   * thread-opening message, so this is normally the whole reply chain; the
   * reader is told rather than left to assume the thread was one comment long.
   */
  hiddenReplies: number;
  /** Who wrote those unrendered replies, recovered from the thread's avatars. */
  hiddenReplyAuthors: string[];
}

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
  /** Comment threads read from Loop's comments pane, in document order. */
  comments: CommentThread[];
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
  /** Inline base64 `data:` images replaced with a placeholder. */
  droppedDataImages: number;
  /** Headings whose section was collapsed, and whose content is therefore absent. */
  collapsedSections: string[];
  /** Comment threads read from the comments pane. */
  commentThreads: number;
  /** How many of those were placed next to the block they annotate. */
  commentsAnchored: number;
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
