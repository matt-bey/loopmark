/**
 * Reading Loop's comment threads.
 *
 * Loop renders comments into `#comments-hosting-element`, a sibling of the
 * page content rather than part of it, so they are collected by a pass of
 * their own and then stitched back into the document as GFM footnotes.
 *
 * Three facts about Loop's markup shape everything here:
 *
 *   1. Threads exist in the DOM only while the comments pane is OPEN. A page
 *      whose pane is closed looks exactly like a page with no comments, except
 *      for the "Open comments" affordance -- which is why that affordance is
 *      checked, and why a closed pane produces a warning rather than silence.
 *
 *   2. The gutter renders only the message that STARTED each thread. Replies
 *      are counted ("2 replies") and their authors appear as avatars, but
 *      their text is not in the page. loopmark will not click to expand them:
 *      that marks a thread as read, which is a change to shared state, and the
 *      read-only rule outranks completeness. The reader is told what is
 *      missing instead.
 *
 *   3. NOTHING in the DOM links a thread to the text it annotates. The thread
 *      ids appear nowhere in the page body. The only signal is geometric --
 *      Loop positions each card to line up with its anchor -- so anchoring
 *      needs a real layout and degrades to an unanchored list when it has
 *      none, which is exactly what happens under `npm run try`.
 */

import { composedParent } from './acquire.js';
import { convertFragment } from './convert.js';
import {
  COMMENTS_PANE_SELECTOR,
  COMMENTS_PRESENT_SELECTOR,
  COMMENT_FEED_SELECTOR,
  COMMENT_ANCHOR_CANDIDATE_SELECTOR,
  COMMENT_ANCHOR_MAX_DRIFT,
  COMMENT_ANCHOR_TOLERANCE,
  COMMENT_AVATAR_SELECTOR,
  COMMENT_BODY_SELECTOR,
  COMMENT_MESSAGE_SELECTOR,
  COMMENT_REPLY_COUNT_PATTERN,
  COMMENT_REPLY_COUNT_SELECTOR,
  COMMENT_STARTED_BY_PATTERN,
  COMMENT_THREAD_SELECTOR,
  COMMENT_TIME_SELECTOR,
} from './selectors.js';
import type { CommentMessage, CommentThread, Diagnostics } from './types.js';

export interface CommentCapture {
  /** Every thread that could be read, in document order. */
  threads: CommentThread[];
  /** Threads placed against the block they annotate. Keys are body elements. */
  anchors: Map<Element, CommentThread[]>;
  /** Threads with no confident anchor; rendered as a plain list instead. */
  unanchored: CommentThread[];
  /** Loop showed an "Open comments" affordance but no thread was readable. */
  paneClosed: boolean;
}

export const EMPTY_CAPTURE: CommentCapture = {
  threads: [],
  anchors: new Map(),
  unanchored: [],
  paneClosed: false,
};

function safeAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/**
 * The elements Loop treats as one thread each.
 *
 * Taken from the pane rather than the whole document so that a comment card
 * rendered somewhere else in the UI -- a hover preview, a notification -- is
 * not mistaken for a thread on this page.
 */
function threadElements(scope: ParentNode): Element[] {
  const found: Element[] = [];
  for (const pane of safeAll(scope, COMMENTS_PANE_SELECTOR)) {
    const feed = pane.querySelector(COMMENT_FEED_SELECTOR) ?? pane;
    for (const el of safeAll(pane, COMMENT_THREAD_SELECTOR)) {
      const wrapper = positionedWrapper(el, feed);
      // `gutterView` and `.conversa-comment` are the same element on today's
      // markup but need not stay that way; take each thread once.
      if (found.some((seen) => seen === wrapper || seen.contains(wrapper))) continue;
      found.push(wrapper);
    }
  }
  return found;
}

/**
 * The element Loop actually positions for a thread.
 *
 * The card is nested a few levels inside a wrapper that is a direct child of
 * the feed, and it is the WRAPPER that carries `position: absolute; top: …`
 * lining the thread up with the text it annotates. Anchoring measures that
 * wrapper: in a browser the two rects nearly coincide, but the wrapper is the
 * element whose position actually means something, and it also carries Loop's
 * thread id.
 */
function positionedWrapper(el: Element, feed: Element): Element {
  let node = el;
  while (node.parentElement && node.parentElement !== feed && feed.contains(node)) {
    node = node.parentElement;
  }
  return feed.contains(node) ? node : el;
}

/** "2 replies" -> 2, "one reply" -> 1, anything else -> 0. */
export function parseReplyCount(text: string | null | undefined): number {
  const match = COMMENT_REPLY_COUNT_PATTERN.exec(text ?? '');
  if (!match) return 0;
  const value = match[1]!.toLowerCase();
  if (value === 'one') return 1;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function avatarNames(scope: Element): string[] {
  const names: string[] = [];
  for (const el of safeAll(scope, COMMENT_AVATAR_SELECTOR)) {
    const name = (el.getAttribute('aria-label') ?? '').trim();
    if (name) names.push(name);
  }
  return names;
}

/**
 * Who wrote a message.
 *
 * The avatar's accessible name, not the visible text beside it: Loop renders
 * the initials ("DW") as a real text node inside the avatar, so a plain text
 * read of the header yields "DWDennis Wolfe". The same trap the @mention
 * handling hit.
 */
function messageAuthor(message: Element): string {
  const fromAvatar = avatarNames(message)[0];
  if (fromAvatar) return fromAvatar;

  // Fallback: the thread's own accessible name says who started it.
  const labelledBy = message.getAttribute('aria-labelledby');
  const scope = labelledBy
    ? (message.ownerDocument.getElementById(labelledBy) ?? message)
    : message;
  const label = scope.getAttribute('aria-label') ?? '';
  const match = COMMENT_STARTED_BY_PATTERN.exec(label);
  return match?.[1]?.trim() || 'Unknown';
}

function messageTimestamp(message: Element): string | null {
  const time = message.querySelector(COMMENT_TIME_SELECTOR);
  const text = (time?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

/**
 * Read one message.
 *
 * The body is a nested Scriptor document, so it goes through the ordinary
 * block pipeline -- bold, links, lists and @mentions inside a comment all work
 * without a line of code here.
 */
function readMessage(message: Element, diag: Diagnostics): CommentMessage | null {
  const body = message.querySelector(COMMENT_BODY_SELECTOR);
  if (!body) return null;
  const blocks = convertFragment(body, diag);
  if (blocks.length === 0) return null;
  return {
    author: messageAuthor(message),
    timestamp: messageTimestamp(message),
    blocks,
  };
}

function readThread(el: Element, index: number, diag: Diagnostics): CommentThread | null {
  const messageEls = safeAll(el, COMMENT_MESSAGE_SELECTOR).filter(
    // `[role="comment"]` and `[data-automation-type="messageItem"]` sit on the
    // same element today; take each message once.
    (m, i, all) => !all.some((other, j) => j < i && other.contains(m)),
  );

  const messages: CommentMessage[] = [];
  for (const messageEl of messageEls) {
    const message = readMessage(messageEl, diag);
    if (message) messages.push(message);
  }
  if (messages.length === 0) return null;

  const hiddenReplies = parseReplyCount(
    el.querySelector(COMMENT_REPLY_COUNT_SELECTOR)?.textContent,
  );

  // Avatars run author-first, then one per reply in order. Dropping as many
  // leading names as there are rendered messages leaves the repliers whose
  // text Loop did not render.
  const hiddenReplyAuthors = hiddenReplies
    ? Array.from(new Set(avatarNames(el).slice(messages.length)))
    : [];

  return {
    id: threadId(el, index),
    label: `c${index + 1}`,
    messages,
    hiddenReplies,
    hiddenReplyAuthors,
  };
}

/** Loop's own thread id when it has one, so re-exports stay comparable. */
function threadId(el: Element, index: number): string {
  let node: Element | null = el;
  for (let hops = 0; node && hops < 4; hops += 1) {
    const id = node.id ?? '';
    if (id && !id.startsWith('listview-')) return id.replace(/^c-/, '');
    node = composedParent(node);
  }
  return `thread-${index + 1}`;
}

// ---------------------------------------------------------------------------
// Anchoring
// ---------------------------------------------------------------------------

interface Box {
  el: Element;
  top: number;
  bottom: number;
}

/**
 * Viewport-space vertical extent, or `null` when there is no layout.
 *
 * jsdom reports every rect as zero, so "no layout" is the normal case offline
 * and must be detected rather than silently producing an anchor of 0 for
 * everything -- which would attach every thread to the first paragraph.
 */
function box(el: Element): Box | null {
  const rect = el.getBoundingClientRect?.();
  if (!rect) return null;
  if (rect.height === 0 && rect.width === 0 && rect.top === 0) return null;
  return { el, top: rect.top, bottom: rect.bottom };
}

/**
 * Match each thread to the block it annotates, by position.
 *
 * Loop lines a gutter card up with the top of the text it refers to, then
 * nudges cards downward so they do not overlap each other. So the anchor is
 * the LAST candidate starting at or above the card, and a card that has
 * drifted further than `COMMENT_ANCHOR_MAX_DRIFT` below any candidate is
 * treated as unmatched rather than guessed at.
 */
export function anchorThreads(
  threads: readonly { thread: CommentThread; el: Element }[],
  root: Element,
): { anchors: Map<Element, CommentThread[]>; unanchored: CommentThread[] } {
  const anchors = new Map<Element, CommentThread[]>();
  const unanchored: CommentThread[] = [];

  const candidates: Box[] = [];
  for (const el of safeAll(root, COMMENT_ANCHOR_CANDIDATE_SELECTOR)) {
    // Loop nests paragraphs inside table cells, and inside the paragraph that
    // hosts the table. A nested candidate has almost the same position as its
    // parent, so it would win the match on a coin toss and drop the marker
    // into the middle of a table. Keep the outermost, whose block is the one
    // a reader would think of as "the thing the comment is on".
    const enclosing = el.parentElement?.closest(COMMENT_ANCHOR_CANDIDATE_SELECTOR);
    if (enclosing && root.contains(enclosing)) continue;

    // Comment bodies are themselves Scriptor documents full of paragraphs, so
    // a content root that fell through to `.scriptor-canvas` would offer the
    // comments' own text as somewhere to anchor comments.
    if (el.closest(COMMENTS_PANE_SELECTOR)) continue;

    const b = box(el);
    if (b) candidates.push(b);
  }
  candidates.sort((a, b) => a.top - b.top);

  for (const { thread, el } of threads) {
    const card = box(el);
    if (!card || candidates.length === 0) {
      unanchored.push(thread);
      continue;
    }

    let best: Box | null = null;
    for (const candidate of candidates) {
      if (candidate.top <= card.top + COMMENT_ANCHOR_TOLERANCE) best = candidate;
      else break;
    }
    // A card above every candidate still belongs to the first one.
    if (!best && candidates[0]!.top - card.top <= COMMENT_ANCHOR_MAX_DRIFT) {
      best = candidates[0]!;
    }
    if (!best || card.top - best.top > COMMENT_ANCHOR_MAX_DRIFT) {
      unanchored.push(thread);
      continue;
    }

    const existing = anchors.get(best.el);
    if (existing) existing.push(thread);
    else anchors.set(best.el, [thread]);
  }

  return { anchors, unanchored };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Read every comment thread on the page and work out where each one belongs.
 *
 * `root` is the content root and is used only as the search space for anchors.
 * `scope` is where the threads themselves are looked for -- the whole document
 * in the bookmarklet, since the comments pane sits OUTSIDE the content root,
 * and a fixture's host element under test.
 */
export function captureComments(
  root: Element,
  scope: ParentNode,
  diag: Diagnostics,
): CommentCapture {
  const elements = threadElements(scope);

  const read: { thread: CommentThread; el: Element }[] = [];
  for (const [index, el] of elements.entries()) {
    const thread = readThread(el, index, diag);
    if (thread) read.push({ thread, el });
  }
  // Labels number the threads that were actually readable, so the footnotes
  // run c1, c2, c3 with no gaps where an empty card was skipped.
  read.forEach(({ thread }, i) => {
    thread.label = `c${i + 1}`;
  });

  const threads = read.map(({ thread }) => thread);
  diag.commentThreads = threads.length;

  if (threads.length === 0) {
    // An "Open comments" button with nothing behind it means the pane is shut.
    const paneClosed = safeAll(scope, COMMENTS_PRESENT_SELECTOR).length > 0;
    diag.commentsAnchored = 0;
    return { threads: [], anchors: new Map(), unanchored: [], paneClosed };
  }

  const { anchors, unanchored } = anchorThreads(read, root);
  diag.commentsAnchored = threads.length - unanchored.length;

  return { threads, anchors, unanchored, paneClosed: false };
}

/** Whether an element carries the "Open comments" affordance. */
export function hasCommentsAffordance(el: Element): boolean {
  return safeMatches(el, COMMENTS_PRESENT_SELECTOR);
}
