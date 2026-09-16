/**
 * loopmark — Phase 0 feasibility probe
 * =====================================
 * READ-ONLY. This script does not click anything, does not write to the page,
 * and makes no network requests. It scrolls the page (and scrolls back) to
 * measure virtualization, then restores the original scroll position.
 *
 * HOW TO RUN
 *   1. Open a Microsoft Loop page in Chrome or Edge.
 *   2. Open DevTools (Cmd+Opt+I) -> Console.
 *   3. If prompted, type "allow pasting" and press Enter.
 *   4. Paste this entire file, press Enter, and wait ~4 seconds.
 *   5. A report prints to the console AND is copied to your clipboard.
 *      (If the clipboard copy fails, run: copy(window.__loopmarkProbe.json))
 */
(async () => {
  'use strict';

  const SETTLE_MS = 400;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------------------
  // 1. Shadow-piercing traversal
  // ---------------------------------------------------------------------------

  /**
   * Walk the composed tree. `element.shadowRoot` is non-null only for OPEN
   * shadow roots -- closed roots are indistinguishable from "no root" here,
   * which is exactly why question 2 below matters so much.
   */
  function walkAll(root, visit, depth = 0, seen = new Set()) {
    if (!root || seen.has(root)) return;
    seen.add(root);
    const children = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of children) {
      visit(el, depth);
      if (el.shadowRoot) {
        visit(el.shadowRoot, depth + 1, true);
        walkAll(el.shadowRoot, visit, depth + 1, seen);
      }
    }
  }

  function collectPierced() {
    const elements = [];
    const shadowHosts = [];
    let maxDepth = 0;
    walkAll(document, (node, depth, isRoot) => {
      if (isRoot) {
        shadowHosts.push({ host: node.host, depth });
        if (depth > maxDepth) maxDepth = depth;
        return;
      }
      elements.push({ el: node, depth });
    });
    return { elements, shadowHosts, maxDepth };
  }

  // ---------------------------------------------------------------------------
  // 2. Text-bearing node counting
  // ---------------------------------------------------------------------------

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);

  /** An element whose own direct text children carry visible characters. */
  function ownText(el) {
    if (!el || SKIP_TAGS.has(el.tagName)) return '';
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function countTextBearing(list) {
    let count = 0;
    let chars = 0;
    for (const el of list) {
      const t = ownText(el);
      if (t) {
        count += 1;
        chars += t.length;
      }
    }
    return { count, chars };
  }

  // ---------------------------------------------------------------------------
  // 3. Suspected-closed-shadow-root heuristic
  // ---------------------------------------------------------------------------

  /**
   * We cannot ask "is this root closed?" directly. We infer it: an element
   * with no children, no text, not a replaced/void element, but with a
   * meaningfully sized rendered box, is painting content we cannot reach.
   */
  const REPLACED = new Set([
    'IMG', 'VIDEO', 'CANVAS', 'SVG', 'IFRAME', 'INPUT', 'TEXTAREA', 'SELECT',
    'OBJECT', 'EMBED', 'HR', 'BR', 'PICTURE', 'AUDIO', 'PROGRESS', 'METER',
  ]);

  function suspectedClosedRoots(list) {
    const suspects = [];
    for (const el of list) {
      if (el.shadowRoot) continue;
      if (SKIP_TAGS.has(el.tagName) || REPLACED.has(el.tagName)) continue;
      if (el.childElementCount > 0) continue;
      if (el.textContent && el.textContent.trim()) continue;
      let box;
      try {
        box = el.getBoundingClientRect();
      } catch {
        continue;
      }
      if (box.width < 40 || box.height < 16) continue;
      const cs = getComputedStyle(el);
      // Elements styled purely as decoration (a background rule, a border) are
      // expected to be empty -- don't flag those.
      const decorative =
        cs.backgroundImage !== 'none' ||
        cs.borderTopWidth !== '0px' ||
        cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      if (decorative) continue;
      suspects.push(el);
    }
    return suspects;
  }

  // ---------------------------------------------------------------------------
  // 4. Heading signal detection
  // ---------------------------------------------------------------------------

  function headingReport(list) {
    const ariaHeadings = [];
    const tagHeadings = [];
    const listItemsWithHeadingRole = [];
    for (const el of list) {
      const role = el.getAttribute && el.getAttribute('role');
      if (role === 'heading') {
        ariaHeadings.push({
          level: el.getAttribute('aria-level') || '(none)',
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        });
        // The '- ' prefix bug: Loop marks headings up as list items.
        if (el.tagName === 'LI' || el.closest?.('li,[role="listitem"]')) {
          listItemsWithHeadingRole.push(el.tagName.toLowerCase());
        }
      }
      if (/^H[1-6]$/.test(el.tagName)) {
        tagHeadings.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        });
      }
    }
    return { ariaHeadings, tagHeadings, listItemsWithHeadingRole };
  }

  // ---------------------------------------------------------------------------
  // 5. Content-root candidate scoring
  // ---------------------------------------------------------------------------

  const ROOT_CANDIDATES = [
    '[data-testid="canvas"]',
    '[class*="Canvas"]',
    '[class*="canvas"]',
    '[role="main"] [contenteditable]',
    '[contenteditable="true"]',
    '[contenteditable]',
    '[role="document"]',
    '[role="textbox"]',
    '[role="main"]',
    'main',
    '[class*="page-content"]',
    '[class*="PageContent"]',
    '[class*="fluid"]',
    '[class*="Editor"]',
    '[class*="editor"]',
  ];

  function scoreRootCandidates(allEls) {
    const results = [];
    for (const sel of ROOT_CANDIDATES) {
      const matches = [];
      for (const el of allEls) {
        try {
          if (el.matches(sel)) matches.push(el);
        } catch { /* invalid selector -- skip */ }
      }
      if (!matches.length) continue;
      // Score by how much text the largest match contains.
      let best = null;
      let bestLen = 0;
      for (const m of matches) {
        const len = (m.textContent || '').trim().length;
        if (len > bestLen) { bestLen = len; best = m; }
      }
      results.push({
        selector: sel,
        matchCount: matches.length,
        bestTextLength: bestLen,
        bestTag: best ? best.tagName.toLowerCase() : null,
        bestClass: best ? String(best.className || '').slice(0, 120) : null,
      });
    }
    return results.sort((a, b) => b.bestTextLength - a.bestTextLength);
  }

  // ---------------------------------------------------------------------------
  // 6. Collapsed / disclosure widgets
  // ---------------------------------------------------------------------------

  function collapsedReport(allEls) {
    const collapsed = [];
    for (const el of allEls) {
      if (el.getAttribute && el.getAttribute('aria-expanded') === 'false') {
        collapsed.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '(none)',
          label: (el.getAttribute('aria-label') || el.textContent || '')
            .replace(/\s+/g, ' ').trim().slice(0, 60),
          testid: el.getAttribute('data-testid') || null,
        });
      }
    }
    return collapsed;
  }

  // ---------------------------------------------------------------------------
  // 7. Structural inventory -- what element/role shapes exist
  // ---------------------------------------------------------------------------

  function inventory(allEls) {
    const tags = {};
    const roles = {};
    const dataTestIds = {};
    for (const el of allEls) {
      tags[el.tagName.toLowerCase()] = (tags[el.tagName.toLowerCase()] || 0) + 1;
      const r = el.getAttribute && el.getAttribute('role');
      if (r) roles[r] = (roles[r] || 0) + 1;
      const t = el.getAttribute && el.getAttribute('data-testid');
      if (t) dataTestIds[t] = (dataTestIds[t] || 0) + 1;
    }
    const top = (obj, n) =>
      Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
        .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});
    return { tags: top(tags, 30), roles: top(roles, 30), dataTestIds: top(dataTestIds, 40) };
  }

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------

  console.log('%cloopmark probe: starting (read-only)', 'font-weight:bold;color:#7c3aed');

  const before = collectPierced();
  const beforeEls = before.elements.map((e) => e.el);
  const beforeText = countTextBearing(beforeEls);
  const plainEls = Array.from(document.querySelectorAll('*'));
  const plainText = countTextBearing(plainEls);

  // --- virtualization test: scroll the tallest scrollable container ---------
  function findScroller(els) {
    let best = document.scrollingElement;
    let bestOverflow = (document.scrollingElement?.scrollHeight || 0) -
      (document.scrollingElement?.clientHeight || 0);
    for (const el of els) {
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow <= bestOverflow) continue;
      const cs = getComputedStyle(el);
      if (!/auto|scroll/.test(cs.overflowY)) continue;
      best = el;
      bestOverflow = overflow;
    }
    return { scroller: best, overflow: bestOverflow };
  }

  const { scroller, overflow } = findScroller(beforeEls);
  const originalScroll = scroller ? scroller.scrollTop : 0;

  if (scroller && overflow > 0) {
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      scroller.scrollTop = (scroller.scrollHeight * i) / steps;
      await sleep(SETTLE_MS);
    }
    scroller.scrollTop = scroller.scrollHeight;
    await sleep(SETTLE_MS * 2);
  }

  const after = collectPierced();
  const afterEls = after.elements.map((e) => e.el);
  const afterText = countTextBearing(afterEls);

  // restore the user's scroll position -- leave no trace
  if (scroller) scroller.scrollTop = originalScroll;

  const suspects = suspectedClosedRoots(afterEls);
  const headings = headingReport(afterEls);

  const report = {
    probeVersion: 1,
    ranAt: new Date().toISOString(),
    host: location.host,
    pathnameShape: location.pathname.replace(/[^/]{6,}/g, '<redacted>'),
    userAgent: navigator.userAgent,

    q1_shadowRootsPresent: after.shadowHosts.length > 0,
    q2_openShadowRoots: after.shadowHosts.length,
    q2_suspectedClosedRoots: suspects.length,
    q2_suspectedClosedSamples: suspects.slice(0, 8).map((el) => ({
      tag: el.tagName.toLowerCase(),
      class: String(el.className || '').slice(0, 100),
      testid: el.getAttribute('data-testid') || null,
      box: (() => { const b = el.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; })(),
    })),
    q3_maxShadowDepth: after.maxDepth,
    q3_shadowHostTags: after.shadowHosts.slice(0, 20).map((h) => ({
      tag: h.host?.tagName?.toLowerCase?.() || '?',
      depth: h.depth,
      class: String(h.host?.className || '').slice(0, 80),
    })),

    q4_piercedTextNodes: afterText.count,
    q4_piercedTextChars: afterText.chars,
    q4_plainTextNodes: plainText.count,
    q4_plainTextChars: plainText.chars,
    q4_deltaNodes: afterText.count - plainText.count,
    q4_deltaChars: afterText.chars - plainText.chars,
    q4_verdict:
      afterText.chars - plainText.chars > 0
        ? 'Shadow piercing IS required -- plain walk misses content.'
        : 'Plain walk sees everything; shadow piercing may be unnecessary.',

    q5_ariaHeadingCount: headings.ariaHeadings.length,
    q5_ariaHeadingSamples: headings.ariaHeadings.slice(0, 15),
    q5_tagHeadingCount: headings.tagHeadings.length,
    q5_tagHeadingSamples: headings.tagHeadings.slice(0, 15),
    q5_headingsInsideListItems: headings.listItemsWithHeadingRole.length,
    q5_verdict:
      headings.ariaHeadings.length > 0
        ? 'role="heading" + aria-level available -- key off this.'
        : 'No role="heading" found -- must fall back to tag names or style heuristics.',

    q6_elementsBeforeScroll: beforeEls.length,
    q6_elementsAfterScroll: afterEls.length,
    q6_textCharsBeforeScroll: beforeText.chars,
    q6_textCharsAfterScroll: afterText.chars,
    q6_scrollerFound: !!scroller,
    q6_scrollerTag: scroller ? scroller.tagName.toLowerCase() : null,
    q6_scrollerClass: scroller ? String(scroller.className || '').slice(0, 120) : null,
    q6_scrollOverflowPx: overflow,
    q6_verdict:
      afterEls.length !== beforeEls.length
        ? `VIRTUALIZED -- node count changed by ${afterEls.length - beforeEls.length} after scrolling.`
        : 'Not virtualized (or page fits on screen) -- node count stable after scroll.',

    contentRootCandidates: scoreRootCandidates(afterEls),
    collapsedWidgets: collapsedReport(afterEls).slice(0, 25),
    collapsedWidgetCount: collapsedReport(afterEls).length,
    inventory: inventory(afterEls),
  };

  const json = JSON.stringify(report, null, 2);
  window.__loopmarkProbe = { report, json };

  console.log('%cloopmark probe: results', 'font-weight:bold;color:#7c3aed');
  console.log('Q1 shadow roots present :', report.q1_shadowRootsPresent);
  console.log('Q2 open shadow roots    :', report.q2_openShadowRoots,
    '| suspected closed:', report.q2_suspectedClosedRoots);
  console.log('Q3 max shadow depth     :', report.q3_maxShadowDepth);
  console.log('Q4', report.q4_verdict, `(delta ${report.q4_deltaChars} chars)`);
  console.log('Q5', report.q5_verdict, `(${report.q5_ariaHeadingCount} aria / ${report.q5_tagHeadingCount} tag)`);
  console.log('Q6', report.q6_verdict);
  console.table(report.contentRootCandidates);
  console.log('Full JSON below -- paste this back to Claude:');
  console.log(json);

  try {
    await navigator.clipboard.writeText(json);
    console.log('%c-> Report copied to clipboard.', 'font-weight:bold;color:#16a34a');
  } catch {
    console.log('%c-> Clipboard blocked. Run:  copy(window.__loopmarkProbe.json)',
      'font-weight:bold;color:#d97706');
  }
})();
