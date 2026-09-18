import { beforeEach, describe, expect, it } from 'vitest';
import { anchorThreads, captureComments, parseReplyCount } from '../src/comments.js';
import { convertElement, emptyDiagnostics, renderBlocks, resetMatchers } from '../src/convert.js';
import { fixture, html } from './helpers.js';
import type { CommentThread } from '../src/types.js';

/**
 * Give an element a layout.
 *
 * jsdom computes none, so anchoring -- which is a comparison of two
 * `getBoundingClientRect()` values -- has nothing to work with unless the
 * positions under test are stated outright. Stating them is also the only way
 * to test the "card pushed below its anchor" case deliberately rather than
 * hoping a real page happens to contain one.
 */
function place(el: Element, top: number, height = 20): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top,
      bottom: top + height,
      height,
      width: 600,
      left: 0,
      right: 600,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }),
  });
}

beforeEach(() => {
  resetMatchers();
});

describe('reading threads', () => {
  it('reads every thread in the pane', () => {
    const host = fixture('loop-comments.html');
    const capture = captureComments(host, host, emptyDiagnostics());

    expect(capture.threads).toHaveLength(2);
    expect(capture.threads.map((t) => t.label)).toEqual(['c1', 'c2']);
    expect(capture.paneClosed).toBe(false);
  });

  it('takes the author from the avatar, not the text beside it', () => {
    const host = fixture('loop-comments.html');
    const capture = captureComments(host, host, emptyDiagnostics());

    // The regression this guards: the avatar renders the initials as a real
    // text node, so a plain text read of the header yields "PAPerson A".
    for (const thread of capture.threads) {
      expect(thread.messages[0]!.author).toBe('Person A');
    }
  });

  it('keeps the relative timestamp Loop displayed', () => {
    const host = fixture('loop-comments.html');
    const capture = captureComments(host, host, emptyDiagnostics());
    expect(capture.threads.map((t) => t.messages[0]!.timestamp)).toEqual([
      '43min ago',
      '47min ago',
    ]);
  });

  it('converts a comment body through the block pipeline', () => {
    const host = fixture('loop-comments.html');
    const capture = captureComments(host, host, emptyDiagnostics());

    // A comment body is a nested Scriptor document, so it arrives as real
    // blocks with real emphasis rather than as flattened text. Asserted on the
    // shape rather than on exact whitespace, which the renderer collapses.
    const blocks = capture.threads[0]!.messages[0]!.blocks;
    expect(blocks).toHaveLength(1);
    const paragraph = blocks[0]!;
    expect(paragraph.type).toBe('paragraph');
    expect(renderBlocks(blocks).trim()).toBe('Weekly feels **too slow** to me.');
  });

  it('counts replies Loop did not render, and names who wrote them', () => {
    const host = fixture('loop-comments.html');
    const capture = captureComments(host, host, emptyDiagnostics());

    expect(capture.threads[0]!.hiddenReplies).toBe(0);
    expect(capture.threads[1]!.hiddenReplies).toBe(2);
    // Avatars run author-first, so dropping the rendered authors leaves the
    // people whose reply text is missing.
    expect(capture.threads[1]!.hiddenReplyAuthors).toEqual(['Reviewer B', 'Person A']);
  });

  it.each([
    ['2 replies', 2],
    ['1 reply', 1],
    ['one reply', 1],
    ['12 replies', 12],
    ['', 0],
    [null, 0],
    ['replies', 0],
  ])('parses a reply count of %s', (text, expected) => {
    expect(parseReplyCount(text)).toBe(expected);
  });
});

describe('a closed comments pane', () => {
  it('is reported rather than passed off as a page with no comments', () => {
    // The affordance with no pane behind it: exactly what Loop renders when
    // the reader has not opened comments.
    const host = html(`
      <div class="scriptor-pageContainer"><div class="scriptor-paragraph">
        <span class="scriptor-textRun">Body text that is long enough to convert.</span>
      </div></div>
      <div class="scriptor-conversa-centralizedViewButton">
        <button aria-label="Open comments" data-automation-type="CentralizedViewButton"></button>
      </div>`);

    const capture = captureComments(host, host, emptyDiagnostics());
    expect(capture.threads).toHaveLength(0);
    expect(capture.paneClosed).toBe(true);

    const result = convertElement(host, undefined, capture);
    expect(result.diagnostics.warnings.join(' ')).toMatch(/comments pane was closed/i);
  });

  it('says nothing about comments on a page that has none', () => {
    const host = html(`
      <div class="scriptor-pageContainer"><div class="scriptor-paragraph">
        <span class="scriptor-textRun">Body text that is long enough to convert.</span>
      </div></div>`);

    const capture = captureComments(host, host, emptyDiagnostics());
    expect(capture.paneClosed).toBe(false);
    const result = convertElement(host, undefined, capture);
    expect(result.diagnostics.warnings.join(' ')).not.toMatch(/comment/i);
    expect(result.markdown).not.toMatch(/comment/i);
  });
});

describe('anchoring', () => {
  const threadsOf = (host: Element): { thread: CommentThread; el: Element }[] => {
    const capture = captureComments(host, host, emptyDiagnostics());
    return capture.threads.map((thread, i) => ({
      thread,
      el: host.querySelectorAll('[role="feed"] > div[id]')[i]!,
    }));
  };

  it('matches a card to the last block starting at or above it', () => {
    const host = fixture('loop-comments.html');
    const root = host.querySelector('.scriptor-pageContainer')!;

    place(host.querySelector('#para-one')!, 100);
    place(host.querySelector('#para-two')!, 400);
    place(host.querySelector('#para-three')!, 700);
    // Loop nudges cards DOWN to stop them overlapping, so a card sits at or
    // below its anchor, never above it.
    place(host.querySelector('#thread-aaa')!, 120, 200);
    place(host.querySelector('#thread-bbb')!, 480, 200);

    const { anchors, unanchored } = anchorThreads(threadsOf(host), root);
    expect(unanchored).toHaveLength(0);
    expect(anchors.get(host.querySelector('#para-one')!)?.[0]?.label).toBe('c1');
    expect(anchors.get(host.querySelector('#para-two')!)?.[0]?.label).toBe('c2');
  });

  it('refuses a match that has drifted too far to be trusted', () => {
    const host = fixture('loop-comments.html');
    const root = host.querySelector('.scriptor-pageContainer')!;

    place(host.querySelector('#para-one')!, 100);
    place(host.querySelector('#para-two')!, 400);
    place(host.querySelector('#para-three')!, 700);
    place(host.querySelector('#thread-aaa')!, 120, 200);
    // Far below every candidate: a guess, and a marker on the wrong paragraph
    // is worse than no marker.
    place(host.querySelector('#thread-bbb')!, 9000, 200);

    const { anchors, unanchored } = anchorThreads(threadsOf(host), root);
    expect(unanchored.map((t) => t.label)).toEqual(['c2']);
    expect(anchors.size).toBe(1);
  });

  it('prefers the outermost block when candidates are nested', () => {
    // Loop nests paragraphs inside table cells, inside the paragraph hosting
    // the table. Without a preference the marker lands inside the table.
    const host = fixture('loop-comments.html');
    const root = host.querySelector('.scriptor-pageContainer')!;
    const outer = host.querySelector('#para-two')!;
    outer.insertAdjacentHTML(
      'beforeend',
      '<div class="scriptor-paragraph" id="para-nested">' +
        '<span class="scriptor-textRun scriptor-inline">Inside a cell.</span></div>',
    );

    place(host.querySelector('#para-one')!, 100);
    place(outer, 400, 60);
    place(host.querySelector('#para-nested')!, 410);
    place(host.querySelector('#thread-aaa')!, 120, 200);
    place(host.querySelector('#thread-bbb')!, 430, 200);

    const { anchors } = anchorThreads(threadsOf(host), root);
    expect(anchors.get(outer)?.[0]?.label).toBe('c2');
    expect(anchors.has(host.querySelector('#para-nested')!)).toBe(false);
  });

  it('never anchors a thread to another comment\'s text', () => {
    // A comment body is a Scriptor document full of paragraphs. With the
    // canvas as the content root -- a real fallback -- those paragraphs would
    // otherwise be offered as somewhere to put a comment marker.
    const host = fixture('loop-comments.html');
    const canvas = host.querySelector('.scriptor-canvas')!;

    place(host.querySelector('#para-one')!, 100);
    for (const p of host.querySelectorAll('#comments-hosting-element .scriptor-paragraph')) {
      place(p, 130);
    }
    place(host.querySelector('#thread-aaa')!, 140, 200);
    place(host.querySelector('#thread-bbb')!, 150, 200);

    const { anchors } = anchorThreads(threadsOf(host), canvas);
    for (const el of anchors.keys()) {
      expect(el.closest('#comments-hosting-element')).toBeNull();
    }
    expect(anchors.get(host.querySelector('#para-one')!)).toHaveLength(2);
  });

  it('anchors nothing when there is no layout to measure', () => {
    // The offline path: jsdom reports every rect as zero, and anchoring every
    // thread to the first paragraph would be worse than not anchoring at all.
    const host = fixture('loop-comments.html');
    const root = host.querySelector('.scriptor-pageContainer')!;
    const { anchors, unanchored } = anchorThreads(threadsOf(host), root);
    expect(anchors.size).toBe(0);
    expect(unanchored).toHaveLength(2);
  });
});

describe('rendering', () => {
  it('marks an anchored thread in the text and defines it as a footnote', () => {
    const host = fixture('loop-comments.html');
    const root = host.querySelector('.scriptor-pageContainer')! as HTMLElement;

    place(host.querySelector('#para-one')!, 100);
    place(host.querySelector('#para-two')!, 400);
    place(host.querySelector('#para-three')!, 700);
    place(host.querySelector('#thread-aaa')!, 120, 200);
    place(host.querySelector('#thread-bbb')!, 480, 200);

    const capture = captureComments(root, host, emptyDiagnostics());
    const md = convertElement(root, undefined, capture).markdown;

    expect(md).toContain('Base images are rebuilt weekly.[^c1]');
    expect(md).toContain('Each team owns its own canary.[^c2]');
    expect(md).toContain('Upstream pulls are mirrored first.\n');
    expect(md).not.toContain('Upstream pulls are mirrored first.[^');

    expect(md).toMatch(/\[\^c1\]: \*\*Person A\*\* · 43min ago/);
    expect(md).toContain('Weekly feels **too slow** to me.');
    expect(md).toMatch(/2 replies from Reviewer B, Person A not captured/);

    // Anchored threads are footnotes, so they never interrupt the body.
    expect(md).not.toContain('## Comments');
  });

  it('indents a footnote continuation so the definition holds its whole body', () => {
    const host = fixture('loop-comments.html');
    const root = host.querySelector('.scriptor-pageContainer')! as HTMLElement;
    place(host.querySelector('#para-one')!, 100);
    place(host.querySelector('#thread-aaa')!, 120, 200);
    place(host.querySelector('#thread-bbb')!, 130, 200);

    const md = convertElement(root, undefined, captureComments(root, host, emptyDiagnostics()))
      .markdown;

    // Four spaces is what makes a multi-paragraph GFM footnote parse.
    expect(md).toMatch(/\n {4}Weekly feels \*\*too slow\*\* to me\./);
  });

  it('lists unanchored threads as a section, never as orphan footnotes', () => {
    const host = fixture('loop-comments.html');
    const root = host.querySelector('.scriptor-pageContainer')! as HTMLElement;

    // No layout, so nothing anchors.
    const md = convertElement(root, undefined, captureComments(root, host, emptyDiagnostics()))
      .markdown;

    expect(md).toContain('## Comments');
    expect(md).toContain('### 1. Person A · 43min ago');
    expect(md).toContain('Weekly feels **too slow** to me.');
    // A footnote definition with no reference pointing at it is DROPPED by
    // GFM renderers, which would silently lose the conversation.
    expect(md).not.toMatch(/^\[\^c\d+\]:/m);
    expect(md).not.toMatch(/\[\^c\d+\]/);
  });

  it('never leaves a footnote reference without a definition', () => {
    const host = fixture('loop-comments.html');
    const root = host.querySelector('.scriptor-pageContainer')! as HTMLElement;
    place(host.querySelector('#para-one')!, 100);
    place(host.querySelector('#para-two')!, 400);
    place(host.querySelector('#thread-aaa')!, 120, 200);
    place(host.querySelector('#thread-bbb')!, 480, 200);

    const md = convertElement(root, undefined, captureComments(root, host, emptyDiagnostics()))
      .markdown;

    const refs = new Set([...md.matchAll(/\[\^(c\d+)\](?!:)/g)].map((m) => m[1]!));
    const defs = new Set([...md.matchAll(/^\[\^(c\d+)\]:/gm)].map((m) => m[1]!));
    expect([...refs].sort()).toEqual([...defs].sort());
    expect(refs.size).toBe(2);
  });

  it('records what it found in the diagnostics', () => {
    const host = fixture('loop-comments.html');
    const root = host.querySelector('.scriptor-pageContainer')! as HTMLElement;
    place(host.querySelector('#para-one')!, 100);
    place(host.querySelector('#thread-aaa')!, 120, 200);
    place(host.querySelector('#thread-bbb')!, 130, 200);

    const result = convertElement(root, undefined, captureComments(root, host, emptyDiagnostics()));
    expect(result.diagnostics.commentThreads).toBe(2);
    expect(result.diagnostics.commentsAnchored).toBe(2);
    expect(result.doc.comments).toHaveLength(2);
  });
});

describe('the page body', () => {
  it('converts identically whether or not the comments pane is open', () => {
    const host = fixture('loop-comments.html');
    const root = host.querySelector('.scriptor-pageContainer')! as HTMLElement;
    const withPane = convertElement(root).markdown;

    host.querySelector('#comments-hosting-element')!.remove();
    resetMatchers();
    const withoutPane = convertElement(root).markdown;

    expect(withPane).toBe(withoutPane);
  });

  it('keeps comment text out of the body even when the root is the canvas', () => {
    // `.scriptor-canvas` is a real content-root fallback, and the pane lives
    // inside it -- so without the exclusion every thread would be printed
    // twice: once mid-document, once as a footnote.
    const host = fixture('loop-comments.html');
    const canvas = host.querySelector('.scriptor-canvas')! as HTMLElement;
    const md = convertElement(canvas).markdown;

    expect(md).toContain('Base images are rebuilt weekly.');
    expect(md).not.toContain('Weekly feels');
    expect(md).not.toContain('Should this be per image?');
    expect(md).not.toContain('Open comments');
  });
});
