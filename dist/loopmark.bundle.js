"use strict";
(() => {
  // src/selectors.ts
  var LOOP_HOSTS = [
    // VERIFIED 2026-09-16 -- the current Loop web app.
    "loop.cloud.microsoft"
  ];
  function isLoopHost(host) {
    const h = host.toLowerCase().replace(/:\d+$/, "");
    return LOOP_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
  }
  var CONTENT_ROOT_CANDIDATES = [
    // VERIFIED 2026-09-16 via loopd -- Scriptor's own page containers.
    { name: "scriptor-page-container", selector: "div.scriptor-pageContainer" },
    { name: "page-container-fuzzy", selector: 'div[class*="pageContainer" i]' },
    { name: "scriptor-first-page", selector: ".scriptor-pageFrame.scriptor-firstPage" },
    { name: "scriptor-page-body", selector: ".scriptor-pageBody" },
    { name: "scriptor-page-frame", selector: ".scriptor-pageFrame" },
    { name: "scriptor-canvas", selector: ".scriptor-canvas" },
    // Loop components embedded in a host page (Teams, Outlook, a Loop workspace).
    { name: "component-part-host", selector: '[id^="componentPartHostingElementId"]' },
    // Structural fallbacks. Loop pages are editable documents, so the
    // contenteditable region is a strong signal independent of class names.
    { name: "main-contenteditable", selector: '[role="main"] [contenteditable="true"]' },
    { name: "contenteditable-true", selector: '[contenteditable="true"]' },
    { name: "contenteditable-any", selector: '[contenteditable]:not([contenteditable="false"])' },
    // ARIA landmarks. Slowest-moving signals; the safety net.
    { name: "aria-document", selector: '[role="document"]' },
    { name: "aria-main", selector: '[role="main"]' },
    { name: "main-element", selector: "main" }
  ];
  var PARAGRAPH_SELECTOR = '.scriptor-paragraph, [class*="scriptor-paragraph" i]';
  var MIN_PARAGRAPHS_FOR_ROOT = 3;
  var MIN_CONTENT_ROOT_CHARS = 40;
  var TITLE_EXCLUDE_SELECTORS = [
    "loopmark-overlay",
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="menu"]',
    '[role="menubar"]',
    '[role="toolbar"]',
    '[role="tooltip"]',
    '[role="navigation"]',
    '[aria-hidden="true"]',
    "[hidden]"
  ];
  var TITLE_CANDIDATES = [
    "#headerContainer .scriptor-pageBody",
    '[id*="headerContainer" i] [class*="pageBody" i]',
    ".scriptor-pageTitle",
    '[data-automation-type="Title"]',
    '[class*="pageTitle" i]',
    '[role="main"] [role="heading"][aria-level="1"]',
    "h1"
  ];
  var EXCLUDE_SELECTORS = [
    // VERIFIED 2026-09-16 via loopd -- the page header carries the cover image,
    // author chips and presence avatars, none of which are document content.
    ".scriptor-pageHeader",
    '[class*="scriptor-pageHeader" i]',
    // The page title is read separately by `findTitle` and rendered as the
    // document's `# ` heading, so including it in the body duplicates it.
    ".scriptor-pageTitle",
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
    ".scriptor-blocks-commands-wrapper",
    ".scriptor-blocks-commands-hover",
    '[data-automation-type="BlockContextMenuButton"]',
    // "New changes. Select to learn who made new changes." unread marker; its
    // accessible name leaks the bare word "New" into the text flow.
    ".scriptor-block-bluedot",
    // The "Add alt text" affordance that appears over an image on hover.
    ".scriptor-image-alt-widget",
    // Zero-width runs Scriptor uses for cursor placement, and screen-reader-only
    // containers that duplicate content already present in the flow.
    ".scriptor-nonDisplayable-textRun",
    ".scriptor-placeholder-aria-hidden",
    ".scriptor-alwaysAccessibleElementContainer",
    // Table furniture: the column-resize grabbers and the parallel, aria-hidden
    // "column grabber" table that mirrors the real one row for row.
    '[data-automation-type="column-grabber-table"]',
    '[data-automation-type="table-column-resize-element"]',
    /**
     * Loop puts two things in a table's `<tfoot>`: an empty spacer row for the
     * "add row" affordance, and a summary row of column aggregates. Neither is
     * document content, and the summary row is the only row without the
     * aria-hidden gutter cell -- so it was also making every table one column
     * wider than it is, with a blank header.
     * VERIFIED 2026-09-16 against a saved Loop page.
     */
    "tfoot",
    '[data-rowid="SUMMARY_ROW_ID"]',
    '[data-testid="summary-row-test-id"]',
    // Buttons are affordances, never prose. Loop puts a "New" row button inside
    // every table, "Go to line" / "Show more lines" inside every code block, and
    // a vote toggle inside every voting cell -- all of which otherwise land in
    // the text flow. Voting is recovered separately, see VOTING_SELECTOR.
    "button",
    "input",
    "select",
    // NOT `[role="button"]`. A <button> element is unambiguously a control, but
    // Loop gives `role="button"` to interactive *content*: an @mention chip is
    // `<div data-testid="resolvedAtMention" role="button">`, and excluding the
    // role dropped every mention on the page. Everything the role rule used to
    // catch -- the "Add alt text" widget, the unread bluedot -- is already
    // excluded by class.
    // VERIFIED 2026-09-16 against two saved Loop pages.
    // Fluent UI renders screen-reader-only help text into a div that is merely
    // referenced by `aria-describedby`, so it is visible to a text walk.
    '[id*="AriaDescription" i]',
    /**
     * A Loop table-of-contents block. Deliberately excluded rather than
     * exported: it is generated from the headings that are already in the
     * output, and its links point at `loop.cloud.microsoft` URLs that resolve
     * for nobody reading the Markdown. Remove this pair to keep it.
     * VERIFIED 2026-09-16 against a saved Loop page.
     */
    ".scriptor-table-of-contents-root",
    '[class*="table-of-contents-root" i]',
    /**
     * IMPORTANT: Loop renders a duplicate, `aria-hidden` copy of list items that
     * belong to an earlier list via `aria-owns`. Excluding aria-hidden subtrees
     * is what stops every bullet in an owned list appearing twice.
     * VERIFIED 2026-09-16 via loopd.
     */
    '[aria-hidden="true"]',
    "[hidden]",
    // loopmark's own overlay, so re-running does not capture the previous run.
    "loopmark-overlay"
  ];
  var EXPANDABLE_ALLOWLIST = [
    /**
     * Loop virtualizes code blocks: a long snippet renders only its first few
     * lines and hides the rest behind "Show more lines".
     * VERIFIED 2026-09-16 against a saved Loop page.
     */
    'button[aria-label*="show more" i]'
  ];
  var DANGEROUS_CLICK_PATTERNS = [
    /delete|remove|trash|discard/i,
    /share|invite|publish|send/i,
    /copy\s*link|move|rename/i,
    /sign\s*out|log\s*out/i,
    /new|add|create|insert/i,
    /settings|options|menu/i,
    /comment|reply|resolve/i
  ];
  var MAX_EXPAND_CLICKS = 200;
  var MIN_SCROLLABLE_OVERFLOW = 24;
  var PREPARE_PASSES = 3;
  var FORCE_RENDER = {
    /** Scroll positions to visit between top and bottom. */
    steps: 8,
    /** Milliseconds to wait after each scroll for new rows to commit. */
    settleMs: 120,
    /** Extra wait at the bottom, where the largest batch usually renders. */
    bottomSettleMs: 350,
    /** Abort after this long, so a huge page degrades rather than hanging. */
    budgetMs: 8e3
  };
  var HEADING_CLASS_PATTERN = /scriptor-collapsibleHeading|scriptor-heading|scriptor-title/i;
  var HEADING_LEVEL_CLASS_PATTERN = /heading\s*(\d)/i;
  var PARAGRAPH_CLASS_PATTERN = /scriptor-paragraph/i;
  var TASK_CLASS_PATTERN = /scriptor-task|scriptor-checkbox/i;
  var CALLOUT_CLASS_PATTERN = /scriptor-callout|scriptor-infoBlock|scriptor-highlightBlock|scriptor-component-block-callout|scriptor-block-callout/i;
  var CODE_BLOCK_CLASS_PATTERN = /scriptor-component-code-block|scriptor-codeBlock|code-snippet/i;
  var INLINE_CODE_CLASS_PATTERN = /scriptor-inlineCode|scriptor-code-editor(?![-a-z])/i;
  var DIVIDER_CLASS_PATTERN = /scriptor-horizontal-divider(?![-a-z])|scriptor-divider(?![-a-z])|scriptor-horizontalRule/i;
  var TABLE_ROW_CLASS_PATTERN = /scriptor-tableRow/i;
  var TABLE_CELL_CLASS_PATTERN = /scriptor-tableCell/i;
  var LINK_CLASS_PATTERN = /scriptor-hyperlink/i;
  var LINK_TITLE_SUFFIX = /\s*\n\s*click to follow link\s*$/i;
  var COMPONENT_SELECTORS = [
    { kind: "loop-task-list", selector: '[data-testid="task-list"]' },
    { kind: "loop-voting-table", selector: '[data-testid="voting-table"]' },
    { kind: "loop-progress-tracker", selector: '[data-testid="progress-tracker"]' },
    { kind: "loop-kanban", selector: '[data-testid="kanban-board"]' },
    { kind: "loop-component", selector: "[data-loop-component]" }
  ];
  var MENTION_SELECTORS = [
    '[data-testid="mention"]',
    '[class*="mention" i]',
    '[class*="personaChip" i]',
    "span[data-lpc-mention]"
  ];
  var CALLOUT_PATTERNS = [
    { pattern: /danger|error|critical|blocker/i, alert: "CAUTION" },
    { pattern: /caution/i, alert: "CAUTION" },
    { pattern: /warn|risk/i, alert: "WARNING" },
    { pattern: /important|key|highlight/i, alert: "IMPORTANT" },
    { pattern: /tip|hint|success|idea/i, alert: "TIP" },
    { pattern: /note|info|callout/i, alert: "NOTE" }
  ];
  var EOP_CLASS_PATTERN = /scriptor-EOP/i;
  var EMBEDDED_BLOCK_SELECTOR = [
    "table",
    '[role="table"]',
    '[role="grid"]',
    '[data-automation-type="Tablero"]',
    '[data-automation-type="user-data-table"]',
    // `.scriptor-component-block`, NOT `.scriptor-hosting-element`: Loop hosts
    // inline components the same way and labels them
    // `scriptor-hosting-element scriptor-component-inline`. An @mention is one
    // of those, and treating it as a block split the paragraph around it into
    // three -- "Web:", the name, then "primary /".
    ".scriptor-component-block",
    ".scriptor-component-code-block",
    ".scriptor-horizontal-divider",
    "pre",
    "ul",
    "ol",
    "blockquote"
  ].join(", ");
  var TABLE_COUNT_SELECTOR = '[data-automation-type="user-data-table"]';
  var VOTING_SELECTOR = '[data-testid="voting-container-test-id"], [data-automation-type="voting" i]';
  var VOTER_COUNT_PATTERN = /(\d+)\s+voters?/i;
  var LIST_MARKER_CSS_VAR = "--scriptor-list-marker-text";
  var ORDERED_MARKER_PATTERN = /^(\d+|[a-z]+)[.)]$/i;
  var BULLET_MARKER_PATTERN = /^[\u2022\u25E6\u25AA\u25CF\u2023\u2043*+-]$/;
  var CODE_LANGUAGE_SELECTOR = '[role="combobox"][aria-label*="language" i]';
  var CODE_CHROME_SELECTOR = [
    '[role="combobox"]',
    // A LaTeX block renders a KaTeX preview of itself below the source, so the
    // fence would contain the equation three times: once as LaTeX, once as
    // MathML for screen readers, once as the visual rendering.
    ".katex",
    ".katex-display",
    '[role="toolbar"]',
    "button",
    '[role="button"]',
    '[class*="lineNumber" i]'
  ].join(", ");
  var CODE_LANGUAGE_ALIASES = {
    dockerfile: "dockerfile",
    yaml: "yaml",
    "c#": "csharp",
    "c++": "cpp",
    "objective-c": "objectivec",
    "plain text": "",
    plaintext: "",
    none: ""
  };
  var COLLAPSED_SECTION_SELECTOR = '[class*="scriptor-collapseButtonContainer" i][aria-expanded="false"],[role="button"][aria-expanded="false"][class*="collaps" i]';
  var FLUENT_WRAPPER_SELECTOR = '.fui-FluentProvider, [data-testid="ComponentFluentProviderId"]';
  var MATH_SELECTOR = ".katex-display, .katex, math";
  var TEX_ANNOTATION_SELECTOR = 'annotation[encoding="application/x-tex"]';

  // src/acquire.ts
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  var isElement = (node) => node.nodeType === 1;
  var isSlot = (node) => isElement(node) && node.tagName === "SLOT";
  function composedChildren(node) {
    if (isElement(node)) {
      const shadow = node.shadowRoot;
      if (shadow) return Array.from(shadow.childNodes);
      if (isSlot(node)) {
        const assigned = node.assignedNodes({ flatten: true });
        if (assigned.length > 0) return assigned;
      }
    }
    return Array.from(node.childNodes);
  }
  function walkComposed(root, visit, stats) {
    const seen = /* @__PURE__ */ new Set();
    const step = (node) => {
      if (seen.has(node)) return;
      seen.add(node);
      if (stats && isElement(node)) {
        stats.elementsVisited += 1;
        if (node.shadowRoot) {
          stats.shadowRootsPierced += 1;
        }
      }
      if (visit(node) === false) return;
      for (const child of composedChildren(node)) step(child);
    };
    step(root);
  }
  function pierceQuerySelectorAll(root, selector) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    walkComposed(root, (node) => {
      if (!isElement(node) || seen.has(node)) return;
      let matched = false;
      try {
        matched = node.matches(selector);
      } catch {
        return false;
      }
      if (matched) {
        seen.add(node);
        out.push(node);
      }
    });
    return out;
  }
  function pierceQuerySelector(root, selector) {
    return pierceQuerySelectorAll(root, selector)[0] ?? null;
  }
  function pierceGetElementById(root, id) {
    if (!id) return null;
    const escaped = id.replace(/["\\]/g, "\\$&");
    return pierceQuerySelector(root, `[id="${escaped}"]`);
  }
  function composedText(node) {
    let out = "";
    walkComposed(node, (n) => {
      if (n.nodeType === 3) out += n.nodeValue ?? "";
    });
    return out;
  }
  function countShadowRoots(root) {
    const stats = { elementsVisited: 0, shadowRootsPierced: 0 };
    walkComposed(root, () => void 0, stats);
    return stats.shadowRootsPierced;
  }
  function findContentRoot(doc = document) {
    const rejected = [];
    for (const candidate of CONTENT_ROOT_CANDIDATES) {
      const matches = pierceQuerySelectorAll(doc, candidate.selector);
      if (matches.length === 0) {
        rejected.push(`${candidate.name}: no match`);
        continue;
      }
      let best = null;
      let bestLen = -1;
      for (const el2 of matches) {
        const len = composedText(el2).trim().length;
        if (len > bestLen) {
          bestLen = len;
          best = el2;
        }
      }
      if (!best || bestLen < MIN_CONTENT_ROOT_CHARS) {
        rejected.push(`${candidate.name}: matched ${matches.length} but only ${bestLen} chars`);
        continue;
      }
      return { root: best, strategy: candidate.name, rejected };
    }
    const paragraphs = pierceQuerySelectorAll(doc, PARAGRAPH_SELECTOR);
    if (paragraphs.length >= MIN_PARAGRAPHS_FOR_ROOT && paragraphs[0]) {
      let parent = composedParent(paragraphs[0]);
      while (parent && parent !== doc.body) {
        if (pierceQuerySelectorAll(parent, PARAGRAPH_SELECTOR).length >= MIN_PARAGRAPHS_FOR_ROOT) {
          return { root: parent, strategy: "paragraph-ancestor", rejected };
        }
        parent = composedParent(parent);
      }
    }
    rejected.push(`paragraph-ancestor: found ${paragraphs.length} paragraph blocks`);
    rejected.push("all candidates exhausted");
    return { root: doc.body, strategy: "fallback-body", rejected };
  }
  function composedParent(el2) {
    if (el2.parentElement) return el2.parentElement;
    const root = el2.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }
  var titleExcludeMatcher = null;
  function inExcludedSubtree(el2) {
    titleExcludeMatcher ?? (titleExcludeMatcher = TITLE_EXCLUDE_SELECTORS.join(", "));
    for (let node = el2; node; node = composedParent(node)) {
      try {
        if (node.matches(titleExcludeMatcher)) return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  function findTitle(doc = document) {
    for (const selector of TITLE_CANDIDATES) {
      for (const el2 of pierceQuerySelectorAll(doc, selector)) {
        if (inExcludedSubtree(el2)) continue;
        const text = composedText(el2).replace(/\s+/g, " ").trim();
        if (text) return text;
      }
    }
    return (doc.title || "Untitled").replace(/\s*[|–—-]\s*(Microsoft )?Loop\s*$/i, "").trim() || "Untitled";
  }
  function clickableLabel(el2) {
    const parts = [
      el2.getAttribute("aria-label") ?? "",
      el2.getAttribute("title") ?? "",
      el2.getAttribute("data-testid") ?? "",
      typeof el2.className === "string" ? el2.className : "",
      (el2.textContent ?? "").slice(0, 120)
    ];
    return parts.join(" ");
  }
  function isSafeToClick(el2) {
    const label = clickableLabel(el2);
    return !DANGEROUS_CLICK_PATTERNS.some((pattern) => pattern.test(label));
  }
  async function expandCollapsed(root) {
    const clicked = /* @__PURE__ */ new Set();
    const deadline = Date.now() + FORCE_RENDER.budgetMs;
    for (let pass = 0; pass < 4; pass += 1) {
      if (Date.now() > deadline || clicked.size >= MAX_EXPAND_CLICKS) break;
      const targets = /* @__PURE__ */ new Set();
      for (const selector of EXPANDABLE_ALLOWLIST) {
        for (const el2 of pierceQuerySelectorAll(root, selector)) {
          if (!clicked.has(el2) && isSafeToClick(el2)) targets.add(el2);
        }
      }
      if (targets.size === 0) break;
      for (const el2 of targets) {
        if (clicked.size >= MAX_EXPAND_CLICKS) break;
        clicked.add(el2);
        try {
          el2.click();
        } catch {
        }
      }
      await sleep(FORCE_RENDER.settleMs);
    }
    return clicked.size;
  }
  function scrollsVertically(el2) {
    if (el2.scrollHeight - el2.clientHeight <= MIN_SCROLLABLE_OVERFLOW) return false;
    try {
      return /auto|scroll|overlay/.test(getComputedStyle(el2).overflowY);
    } catch {
      return false;
    }
  }
  function findScroller(root, doc = document) {
    if (isElement(root)) {
      for (let el2 = composedParent(root); el2; el2 = composedParent(el2)) {
        if (scrollsVertically(el2)) return el2;
      }
    }
    const scrolling = doc.scrollingElement;
    if (scrolling && scrolling.scrollHeight - scrolling.clientHeight > MIN_SCROLLABLE_OVERFLOW) {
      return scrolling;
    }
    let best = null;
    let bestOverflow = MIN_SCROLLABLE_OVERFLOW;
    walkComposed(root, (node) => {
      if (!isElement(node)) return;
      const overflow = node.scrollHeight - node.clientHeight;
      if (overflow <= bestOverflow || !scrollsVertically(node)) return;
      best = node;
      bestOverflow = overflow;
    });
    return best;
  }
  async function forceRender(root, doc = document) {
    const scroller = findScroller(root, doc);
    if (!scroller) return false;
    const original = scroller.scrollTop;
    const deadline = Date.now() + FORCE_RENDER.budgetMs;
    for (let i = 1; i <= FORCE_RENDER.steps; i += 1) {
      if (Date.now() > deadline) break;
      scroller.scrollTop = scroller.scrollHeight * i / FORCE_RENDER.steps;
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

  // src/convert.ts
  var isElement2 = (node) => node.nodeType === 1;
  var isText = (node) => node.nodeType === 3;
  function makeMatcher(selectors) {
    const valid = [];
    for (const selector of selectors) {
      try {
        document.createDocumentFragment().querySelector(selector);
        valid.push(selector);
      } catch {
      }
    }
    if (valid.length === 0) return () => false;
    const joined = valid.join(",");
    return (el2) => {
      try {
        return el2.matches(joined);
      } catch {
        return false;
      }
    };
  }
  var matchExcluded = null;
  var matchMention = null;
  function excluded(el2) {
    matchExcluded ?? (matchExcluded = makeMatcher(EXCLUDE_SELECTORS));
    return matchExcluded(el2);
  }
  function isMention(el2) {
    matchMention ?? (matchMention = makeMatcher(MENTION_SELECTORS));
    return matchMention(el2);
  }
  function componentKind(el2) {
    for (const { kind, selector } of COMPONENT_SELECTORS) {
      try {
        if (el2.matches(selector)) return kind;
      } catch {
      }
    }
    return null;
  }
  function classOf(el2) {
    const value = el2.className;
    return typeof value === "string" ? value : el2.getAttribute("class") ?? "";
  }
  var attrBag = (el2) => [
    classOf(el2),
    el2.getAttribute("data-testid") ?? "",
    el2.getAttribute("data-callout-type") ?? "",
    el2.getAttribute("data-type") ?? "",
    el2.getAttribute("aria-label") ?? "",
    el2.getAttribute("role") ?? ""
  ].join(" ");
  var INLINE_TAGS = /* @__PURE__ */ new Set([
    "SPAN",
    "A",
    "STRONG",
    "B",
    "EM",
    "I",
    "U",
    "S",
    "STRIKE",
    "DEL",
    "INS",
    "CODE",
    "KBD",
    "SAMP",
    "VAR",
    "SUB",
    "SUP",
    "MARK",
    "SMALL",
    "ABBR",
    "CITE",
    "Q",
    "TIME",
    "IMG",
    "BR",
    "LABEL",
    "FONT",
    "BIG",
    "TT",
    "BDI",
    "BDO",
    "RUBY",
    "RT",
    "RP",
    "WBR",
    "NOBR",
    "DFN"
  ]);
  var KNOWN_CONTAINERS = /* @__PURE__ */ new Set([
    "DIV",
    "SECTION",
    "ARTICLE",
    "MAIN",
    "ASIDE",
    "HEADER",
    "FOOTER",
    "NAV",
    "FORM",
    "FIELDSET",
    "FIGURE",
    "FIGCAPTION",
    "DL",
    "DT",
    "DD",
    "ADDRESS",
    "BODY",
    "HTML",
    "TEMPLATE",
    "SLOT",
    "DETAILS",
    "SUMMARY",
    "CENTER"
  ]);
  var SKIP_TAGS = /* @__PURE__ */ new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "HEAD",
    "TITLE",
    "META",
    "LINK",
    // Form controls carry no document text. Checkbox *state* is read directly by
    // `checkedState`, so skipping them here loses nothing and avoids emitting an
    // empty container for every checklist item.
    "INPUT",
    "SELECT",
    "TEXTAREA",
    "OPTION",
    "OPTGROUP",
    "PROGRESS",
    "METER"
  ]);
  function classify(el2) {
    const tag = el2.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return "skip";
    if (excluded(el2)) return "skip";
    if (isFluentWrapper(el2)) return "container";
    const role = (el2.getAttribute("role") ?? "").toLowerCase();
    const cls = classOf(el2);
    if (role === "heading" || /^H[1-6]$/.test(tag) || HEADING_CLASS_PATTERN.test(cls) || (el2.getAttribute("data-automation-type") ?? "").toLowerCase().includes("heading")) {
      return "heading";
    }
    if (isMath(el2)) return "inline";
    try {
      if (el2.matches(VOTING_SELECTOR)) return "inline";
    } catch {
    }
    if (componentKind(el2)) return "component";
    if (isMention(el2)) return "inline";
    if (tag === "PRE" || CODE_BLOCK_CLASS_PATTERN.test(cls)) return "code";
    if (tag === "HR" || role === "separator" || DIVIDER_CLASS_PATTERN.test(cls)) return "break";
    if (tag === "TABLE" || role === "table" || role === "grid") return "table";
    if (/scriptor-table(?!-of-)/i.test(cls) && !TABLE_ROW_CLASS_PATTERN.test(cls) && !TABLE_CELL_CLASS_PATTERN.test(cls)) {
      return "table";
    }
    if (tag === "UL" || tag === "OL" || tag === "MENU" || role === "list") return "list";
    if (tag === "BLOCKQUOTE" || role === "note" || CALLOUT_CLASS_PATTERN.test(cls) || isCalloutish(el2)) {
      return "quote";
    }
    if (TASK_CLASS_PATTERN.test(cls)) return "task";
    if (PARAGRAPH_CLASS_PATTERN.test(cls)) {
      return containsEmbeddedBlock(el2) ? "container" : "paragraph";
    }
    if (INLINE_TAGS.has(tag)) {
      return containsEmbeddedBlock(el2) ? "container" : "inline";
    }
    return "container";
  }
  function containsEmbeddedBlock(el2) {
    try {
      return el2.querySelector(EMBEDDED_BLOCK_SELECTOR) !== null;
    } catch {
      return false;
    }
  }
  function isCollapsedSection(el2) {
    try {
      return el2.querySelector(COLLAPSED_SECTION_SELECTOR) !== null;
    } catch {
      return false;
    }
  }
  function isMath(el2) {
    try {
      return el2.matches(MATH_SELECTOR);
    } catch {
      return false;
    }
  }
  function mathNode(el2) {
    if (!isMath(el2)) return null;
    const annotation = el2.querySelector(TEX_ANNOTATION_SELECTOR);
    const value = (annotation?.textContent ?? "").trim();
    if (!value) return null;
    return { type: "math", value, display: /\n/.test(value) };
  }
  function isFluentWrapper(el2) {
    try {
      return el2.matches(FLUENT_WRAPPER_SELECTOR);
    } catch {
      return false;
    }
  }
  function isCalloutish(el2) {
    if (el2.hasAttribute("data-callout-type")) return true;
    return /callout|admonition|banner-message|infobox/i.test(attrBag(el2));
  }
  function calloutAlert(el2) {
    const bag = attrBag(el2);
    for (const { pattern, alert } of CALLOUT_PATTERNS) {
      if (pattern.test(bag)) return alert;
    }
    return null;
  }
  function headingLevel(el2) {
    const aria = el2.getAttribute("aria-level");
    if (aria) {
      const n = parseInt(aria, 10);
      if (n >= 1 && n <= 6) return n;
    }
    const m = /^H([1-6])$/.exec(el2.tagName.toUpperCase());
    if (m?.[1]) return parseInt(m[1], 10);
    const fromClass = HEADING_LEVEL_CLASS_PATTERN.exec(classOf(el2));
    if (fromClass?.[1]) {
      const n = parseInt(fromClass[1], 10);
      if (n >= 1 && n <= 6) return n;
    }
    return 3;
  }
  function computed(el2) {
    try {
      return getComputedStyle(el2);
    } catch {
      return null;
    }
  }
  function introduces(el2, read, inlineValue, test) {
    if (test(inlineValue)) {
      const parent2 = el2.parentElement ? computed(el2.parentElement) : null;
      if (!parent2 || !test(read(parent2))) return true;
    }
    const own = computed(el2);
    if (!own || !test(read(own))) return false;
    const parent = el2.parentElement ? computed(el2.parentElement) : null;
    return !(parent && test(read(parent)));
  }
  var isBoldWeight = (v) => /^(bold|bolder|[6-9]00)$/.test(v.trim());
  var isItalicStyle = (v) => /italic|oblique/.test(v);
  var isStruck = (v) => /line-through/.test(v);
  function styleSaysBold(el2) {
    return introduces(el2, (s) => s.fontWeight, el2.style?.fontWeight ?? "", isBoldWeight);
  }
  function styleSaysItalic(el2) {
    return introduces(el2, (s) => s.fontStyle, el2.style?.fontStyle ?? "", isItalicStyle);
  }
  function styleSaysStrike(el2) {
    return introduces(
      el2,
      (s) => s.textDecorationLine || s.textDecoration || "",
      el2.style?.textDecoration ?? "",
      isStruck
    );
  }
  function resolveHref(el2) {
    const direct = el2.getAttribute("href") ?? el2.getAttribute("data-href") ?? "";
    if (direct) return direct;
    const title = (el2.getAttribute("title") ?? "").replace(LINK_TITLE_SUFFIX, "").trim();
    const first = (title.split("\n")[0] ?? "").trim();
    return /^(https?:\/\/|mailto:|tel:|\/)/i.test(first) ? first : "";
  }
  var MAX_DEPTH = 120;
  function inlineChildren(el2, ctx) {
    const out = [];
    for (const child of composedChildren(el2)) out.push(...toInline(child, ctx));
    return out;
  }
  var LOOP_EMPTY_ALT = /^\s*(image has no description|add alt text)\s*$/i;
  var DATA_IMAGE_PLACEHOLDER = "#image-omitted";
  function imageAlt(el2) {
    const alt = el2.getAttribute("alt") ?? el2.getAttribute("aria-label") ?? "";
    return LOOP_EMPTY_ALT.test(alt) || !alt.trim() ? "image" : alt;
  }
  function votingSummary(el2) {
    try {
      if (!el2.matches(VOTING_SELECTOR)) return null;
    } catch {
      return null;
    }
    const labelled = el2.hasAttribute("aria-label") ? el2 : el2.querySelector("[aria-label]");
    const match = VOTER_COUNT_PATTERN.exec(labelled?.getAttribute("aria-label") ?? "");
    const count = match?.[1] ? parseInt(match[1], 10) : 0;
    return count === 1 ? "1 vote" : `${count} votes`;
  }
  function visibleText(node) {
    let out = "";
    const visit = (n) => {
      if (isText(n)) {
        out += n.nodeValue ?? "";
        return;
      }
      if (!isElement2(n)) return;
      if (SKIP_TAGS.has(n.tagName.toUpperCase()) || excluded(n)) return;
      for (const child of composedChildren(n)) visit(child);
    };
    visit(node);
    return out;
  }
  function mentionName(el2) {
    const text = visibleText(el2).replace(/\s+/g, " ").trim();
    if (text) return text;
    return (el2.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
  }
  function isDataUri(src) {
    return /^data:/i.test(src.trim());
  }
  function toInline(node, ctx) {
    if (ctx.depth > MAX_DEPTH) return [];
    if (isText(node)) {
      const value = (node.nodeValue ?? "").replace(/\s+/g, " ");
      return value ? [{ type: "text", value }] : [];
    }
    if (!isElement2(node)) return [];
    const tag = node.tagName.toUpperCase();
    const votes = votingSummary(node);
    if (votes !== null) return [{ type: "text", value: votes }];
    if (SKIP_TAGS.has(tag) || excluded(node)) return [];
    ctx.depth += 1;
    try {
      if (tag === "BR") {
        if (EOP_CLASS_PATTERN.test(classOf(node))) return [];
        return [{ type: "break" }];
      }
      if (tag === "IMG") {
        const src = node.getAttribute("src") ?? "";
        const alt = imageAlt(node);
        if (src && !isDataUri(src)) ctx.imageUrls.push(src);
        if (!src) return [];
        if (isDataUri(src)) {
          ctx.diag.droppedDataImages += 1;
          return [{ type: "image", alt, src: DATA_IMAGE_PLACEHOLDER }];
        }
        return [{ type: "image", alt, src }];
      }
      const math = mathNode(node);
      if (math) return [math];
      if (isMention(node)) {
        const name = mentionName(node);
        return name ? [{ type: "mention", name }] : [];
      }
      const cls = classOf(node);
      const role = (node.getAttribute("role") ?? "").toLowerCase();
      if (tag === "A" || role === "link" || LINK_CLASS_PATTERN.test(cls)) {
        const href = resolveHref(node);
        const children2 = inlineChildren(node, ctx);
        if (!href) return children2;
        return [{ type: "link", href, children: children2 }];
      }
      if (tag === "CODE" || tag === "KBD" || tag === "SAMP" || tag === "TT" || INLINE_CODE_CLASS_PATTERN.test(cls)) {
        const value = composedText(node).replace(/\s+/g, " ");
        return value.trim() ? [{ type: "code", value }] : [];
      }
      let children = inlineChildren(node, ctx);
      if (children.length === 0) return [];
      const bold = tag === "STRONG" || tag === "B" || styleSaysBold(node);
      const italic = tag === "EM" || tag === "I" || tag === "CITE" || styleSaysItalic(node);
      const strike = tag === "DEL" || tag === "S" || tag === "STRIKE" || styleSaysStrike(node);
      if (italic) children = [{ type: "em", children }];
      if (bold) children = [{ type: "strong", children }];
      if (strike) children = [{ type: "del", children }];
      return children;
    } finally {
      ctx.depth -= 1;
    }
  }
  function inlineIsEmpty(nodes) {
    return !nodes.some((n) => {
      if (n.type === "text") return n.value.trim() !== "";
      if (n.type === "code" || n.type === "mention" || n.type === "math") return true;
      if (n.type === "image") return true;
      if (n.type === "link") return true;
      if (n.type === "break") return false;
      return !inlineIsEmpty(n.children);
    });
  }
  function mergeAdjacent(nodes) {
    const out = [];
    for (const node of nodes) {
      const prev = out[out.length - 1];
      if (prev && prev.type === node.type) {
        if (node.type === "text" && prev.type === "text") {
          out[out.length - 1] = { type: "text", value: prev.value + node.value };
          continue;
        }
        if (node.type === "code" && prev.type === "code") {
          out[out.length - 1] = { type: "code", value: prev.value + node.value };
          continue;
        }
        if ((node.type === "strong" || node.type === "em" || node.type === "del") && (prev.type === "strong" || prev.type === "em" || prev.type === "del")) {
          out[out.length - 1] = {
            type: node.type,
            children: mergeAdjacent([...prev.children, ...node.children])
          };
          continue;
        }
      }
      if (node.type === "text" && /^\s+$/.test(node.value) && out.length > 0) {
        const before = out[out.length - 1];
        if (before.type === "strong" || before.type === "em" || before.type === "del") {
          out.push(node);
          continue;
        }
      }
      out.push(node);
    }
    return joinAcrossSpace(out);
  }
  function joinAcrossSpace(nodes) {
    const out = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const gap = nodes[i + 1];
      const next = nodes[i + 2];
      if ((node.type === "strong" || node.type === "em" || node.type === "del") && gap?.type === "text" && /^\s+$/.test(gap.value) && next?.type === node.type) {
        nodes[i + 2] = {
          type: node.type,
          children: [...node.children, { type: "text", value: gap.value }, ...next.children]
        };
        i += 1;
        continue;
      }
      out.push(node);
    }
    return out;
  }
  function trimInline(nodes) {
    const out = mergeAdjacent(nodes);
    while (out.length && out[0].type === "break") out.shift();
    while (out.length && out[out.length - 1].type === "break") out.pop();
    if (out.length) {
      const first = out[0];
      if (first.type === "text") out[0] = { type: "text", value: first.value.replace(/^\s+/, "") };
      const last = out[out.length - 1];
      if (last.type === "text") {
        out[out.length - 1] = { type: "text", value: last.value.replace(/\s+$/, "") };
      }
    }
    return out.filter((n) => !(n.type === "text" && n.value === ""));
  }
  function collectBlocks(el2, ctx) {
    if (ctx.depth > MAX_DEPTH) return [];
    ctx.depth += 1;
    try {
      const out = [];
      let pending = [];
      const flush = () => {
        const trimmed = trimInline(pending);
        pending = [];
        if (trimmed.length === 0 || inlineIsEmpty(trimmed)) return;
        if (trimmed.length === 1 && trimmed[0].type === "image") {
          const img = trimmed[0];
          out.push({ type: "image", alt: img.alt, src: img.src });
          return;
        }
        out.push({ type: "paragraph", children: trimmed });
      };
      for (const child of composedChildren(el2)) {
        if (isText(child)) {
          pending.push(...toInline(child, ctx));
          continue;
        }
        if (!isElement2(child)) continue;
        const kind = classify(child);
        if (kind === "skip") continue;
        if (kind === "inline") {
          pending.push(...toInline(child, ctx));
          continue;
        }
        flush();
        switch (kind) {
          case "heading": {
            const children = trimInline(inlineChildren(child, ctx));
            out.push({ type: "heading", level: headingLevel(child), children });
            if (isCollapsedSection(child)) {
              const name = renderInline(children).trim();
              ctx.diag.collapsedSections.push(name || "(untitled section)");
              out.push({
                type: "paragraph",
                children: [
                  {
                    type: "em",
                    children: [
                      {
                        type: "text",
                        value: "(loopmark: this section is collapsed in Loop, so its content was not in the page. Expand it and export again.)"
                      }
                    ]
                  }
                ]
              });
            }
            break;
          }
          case "list":
            out.push(...buildList(child, ctx));
            break;
          case "table": {
            const table = buildTable(child, ctx);
            if (table) out.push(table);
            break;
          }
          case "code":
            out.push(buildCode(child, ctx));
            break;
          case "quote":
            out.push({
              type: "quote",
              alert: calloutAlert(child),
              blocks: collectBlocks(child, ctx)
            });
            break;
          case "break":
            out.push({ type: "thematicBreak" });
            break;
          case "component":
            out.push({
              type: "component",
              kind: componentKind(child) ?? "loop-component",
              blocks: collectBlocks(child, ctx)
            });
            break;
          case "paragraph":
            out.push(...buildParagraph(child, ctx));
            break;
          case "task": {
            const checked = checkedState(child) ?? false;
            const taskBlocks = collectBlocks(child, ctx);
            const item = {
              checked,
              blocks: checked ? stripStrikethrough(taskBlocks) : taskBlocks
            };
            const previous = out[out.length - 1];
            if (previous && previous.type === "list" && !previous.ordered) {
              previous.items.push(item);
            } else {
              out.push({ type: "list", ordered: false, start: 1, items: [item] });
            }
            break;
          }
          case "container": {
            const tag = child.tagName.toUpperCase();
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
  function isLoopList(block) {
    return block.type === "list" && block.items.length > 0 && block.items.every((item) => item.level !== void 0);
  }
  function mergeAndNestLists(blocks) {
    const merged = [];
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
  function nestLoopList(block) {
    if (!isLoopList(block)) return block;
    const items = block.items;
    const baseLevel = items[0].level ?? 1;
    if (!items.some((item) => (item.level ?? 1) > baseLevel)) return block;
    const root = { type: "list", ordered: block.ordered, start: block.start, items: [] };
    const stack = [{ level: baseLevel, list: root }];
    for (const item of items) {
      const level = item.level ?? baseLevel;
      while (stack.length > 1 && level < stack[stack.length - 1].level) stack.pop();
      let top = stack[stack.length - 1];
      if (level > top.level) {
        const parent = top.list.items[top.list.items.length - 1];
        const child = {
          type: "list",
          ordered: item.ordered === true,
          start: item.position ?? 1,
          items: []
        };
        if (parent) {
          parent.blocks.push(child);
          stack.push({ level, list: child });
          top = stack[stack.length - 1];
        }
      }
      top.list.items.push(item);
    }
    return root;
  }
  function buildParagraph(el2, ctx) {
    const BLOCK_KINDS = ["list", "table", "code", "quote", "heading", "component", "task"];
    const kids = composedChildren(el2).filter(isElement2);
    if (kids.some((kid) => BLOCK_KINDS.includes(classify(kid)))) {
      return collectBlocks(el2, ctx);
    }
    const children = [];
    for (const kid of composedChildren(el2)) {
      if (isElement2(kid) && classify(kid) === "container") {
        if (inlineIsEmpty(children)) children.length = 0;
        else children.push({ type: "break" });
        children.push(...inlineChildren(kid, ctx));
        continue;
      }
      children.push(...toInline(kid, ctx));
    }
    const trimmed = trimInline(children);
    if (trimmed.length === 0 || inlineIsEmpty(trimmed)) return [];
    if (trimmed.length === 1 && trimmed[0].type === "image") {
      const img = trimmed[0];
      return [{ type: "image", alt: img.alt, src: img.src }];
    }
    return [{ type: "paragraph", children: trimmed }];
  }
  function listItemElements(listEl) {
    const owns = listEl.getAttribute("aria-owns");
    if (owns) {
      const owned = [];
      for (const id of owns.split(/\s+/)) {
        const el2 = pierceGetElementById(listEl.ownerDocument ?? document, id);
        if (el2 && !excluded(el2)) owned.push(el2);
      }
      if (owned.length > 0) return owned;
    }
    const items = [];
    for (const child of composedChildren(listEl)) {
      if (!isElement2(child)) continue;
      if (SKIP_TAGS.has(child.tagName.toUpperCase()) || excluded(child)) continue;
      const role = (child.getAttribute("role") ?? "").toLowerCase();
      if (child.tagName.toUpperCase() === "LI" || role === "listitem" || TASK_CLASS_PATTERN.test(classOf(child))) {
        items.push(child);
        continue;
      }
      if (role === "presentation" || role === "none" || child.tagName.toUpperCase() === "DIV") {
        items.push(...listItemElements(child));
      }
    }
    return items;
  }
  function checkedState(el2) {
    const ariaChecked = el2.getAttribute("aria-checked");
    if (ariaChecked === "true") return true;
    if (ariaChecked === "false") return false;
    const role = (el2.getAttribute("role") ?? "").toLowerCase();
    if (role === "checkbox") return false;
    const search = (node, depth) => {
      if (depth > 3) return null;
      for (const child of composedChildren(node)) {
        if (!isElement2(child)) continue;
        const tag = child.tagName.toUpperCase();
        if (tag === "INPUT" && child.getAttribute("type") === "checkbox") {
          return child.checked || child.hasAttribute("checked");
        }
        const nested = child.getAttribute("aria-checked");
        if (nested === "true") return true;
        if (nested === "false") return false;
        if ((child.getAttribute("role") ?? "").toLowerCase() === "checkbox") return false;
        const deeper = search(child, depth + 1);
        if (deeper !== null) return deeper;
      }
      return null;
    };
    const found = search(el2, 0);
    if (found !== null) return found;
    return TASK_CLASS_PATTERN.test(classOf(el2)) ? false : null;
  }
  function loopListMarker(li) {
    const style = li.style;
    const raw = style?.getPropertyValue?.(LIST_MARKER_CSS_VAR) ?? "";
    const marker = raw.replace(/^\s*["']|["']\s*$/g, "").trim();
    return marker === "" ? null : marker;
  }
  function markerIsOrdered(marker) {
    if (marker === null) return false;
    if (BULLET_MARKER_PATTERN.test(marker)) return false;
    return ORDERED_MARKER_PATTERN.test(marker);
  }
  function ariaNumber(el2, attr) {
    const raw = el2.getAttribute(attr);
    if (raw === null) return void 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : void 0;
  }
  function stripStrikethrough(blocks) {
    const inlines = (nodes) => nodes.flatMap((node) => {
      if (node.type === "del") return inlines(node.children);
      if (node.type === "strong" || node.type === "em") {
        return [{ ...node, children: inlines(node.children) }];
      }
      if (node.type === "link") return [{ ...node, children: inlines(node.children) }];
      return [node];
    });
    return blocks.map((block) => {
      switch (block.type) {
        case "paragraph":
        case "heading":
          return { ...block, children: inlines(block.children) };
        case "quote":
        case "component":
          return { ...block, blocks: stripStrikethrough(block.blocks) };
        case "list":
          return {
            ...block,
            items: block.items.map((i) => ({ ...i, blocks: stripStrikethrough(i.blocks) }))
          };
        default:
          return block;
      }
    });
  }
  function buildList(listEl, ctx) {
    const ordered = listEl.tagName.toUpperCase() === "OL" || (listEl.getAttribute("role") ?? "").toLowerCase() === "list" && listEl.hasAttribute("start");
    const startAttr = parseInt(listEl.getAttribute("start") ?? "1", 10);
    const start = Number.isFinite(startAttr) && startAttr > 0 ? startAttr : 1;
    const out = [];
    let bucket = [];
    const flushBucket = () => {
      if (bucket.length === 0) return;
      const first = bucket[0];
      out.push({
        type: "list",
        ordered: ordered || first.ordered === true,
        start: first.position ?? start,
        items: bucket
      });
      bucket = [];
    };
    for (const itemEl of listItemElements(listEl)) {
      if ((itemEl.getAttribute("role") ?? "").toLowerCase() === "heading") {
        flushBucket();
        out.push({
          type: "heading",
          level: headingLevel(itemEl),
          children: trimInline(inlineChildren(itemEl, ctx))
        });
        continue;
      }
      const blocks = collectBlocks(itemEl, ctx);
      if (blocks.length === 0) continue;
      if (blocks.length === 1 && blocks[0].type === "heading") {
        flushBucket();
        out.push(blocks[0]);
        continue;
      }
      const marker = loopListMarker(itemEl);
      const checked = checkedState(itemEl);
      const item = {
        checked,
        blocks: checked === true ? stripStrikethrough(blocks) : blocks
      };
      const level = ariaNumber(itemEl, "aria-level");
      if (level !== void 0) item.level = level;
      if (marker !== null) item.ordered = markerIsOrdered(marker);
      const position = ariaNumber(itemEl, "aria-posinset");
      if (position !== void 0) item.position = position;
      bucket.push(item);
    }
    flushBucket();
    if (out.length === 0) return collectBlocks(listEl, ctx);
    return out;
  }
  function tableRows(el2) {
    const rows = [];
    const visit = (node) => {
      for (const child of composedChildren(node)) {
        if (!isElement2(child)) continue;
        if (SKIP_TAGS.has(child.tagName.toUpperCase()) || excluded(child)) continue;
        const tag = child.tagName.toUpperCase();
        const role = (child.getAttribute("role") ?? "").toLowerCase();
        if (tag === "TR" || role === "row" || TABLE_ROW_CLASS_PATTERN.test(classOf(child))) {
          rows.push(child);
          continue;
        }
        visit(child);
      }
    };
    visit(el2);
    return rows;
  }
  function rowCells(row) {
    const cells = [];
    const visit = (node) => {
      for (const child of composedChildren(node)) {
        if (!isElement2(child)) continue;
        if (SKIP_TAGS.has(child.tagName.toUpperCase()) || excluded(child)) continue;
        const tag = child.tagName.toUpperCase();
        const role = (child.getAttribute("role") ?? "").toLowerCase();
        if (tag === "TD" || tag === "TH" || role === "cell" || role === "gridcell" || role === "columnheader" || role === "rowheader" || TABLE_CELL_CLASS_PATTERN.test(classOf(child))) {
          cells.push(child);
          continue;
        }
        visit(child);
      }
    };
    visit(row);
    return cells;
  }
  function isHeaderRow(row) {
    const cells = rowCells(row);
    if (cells.length === 0) return false;
    return cells.every((c) => {
      const role = (c.getAttribute("role") ?? "").toLowerCase();
      return c.tagName.toUpperCase() === "TH" || role === "columnheader";
    });
  }
  function blocksToInline(blocks) {
    const out = [];
    const push = (nodes) => {
      const trimmed = trimInline(nodes);
      if (trimmed.length === 0) return;
      if (out.length > 0) out.push({ type: "break" });
      out.push(...trimmed);
    };
    for (const block of blocks) {
      switch (block.type) {
        case "heading":
        case "paragraph":
          push(block.children);
          break;
        case "list":
          for (const item of block.items) {
            const box = item.checked === null ? "" : item.checked ? "[x] " : "[ ] ";
            push([{ type: "text", value: `\u2022 ${box}` }, ...blocksToInline(item.blocks)]);
          }
          break;
        case "code":
          push([{ type: "code", value: block.value.replace(/\s+/g, " ").trim() }]);
          break;
        case "quote":
        case "component":
          push(blocksToInline(block.blocks));
          break;
        case "image":
          push([{ type: "image", alt: block.alt, src: block.src }]);
          break;
        case "table":
          push([{ type: "text", value: "(nested table omitted)" }]);
          break;
        case "thematicBreak":
          break;
      }
    }
    return out;
  }
  var MAX_TABLE_DEPTH = 3;
  function cellInline(cell, ctx) {
    return trimInline(blocksToInline(collectBlocks(cell, ctx)));
  }
  function buildTable(el2, ctx) {
    if (ctx.tableDepth >= MAX_TABLE_DEPTH) return null;
    const rows = tableRows(el2);
    if (rows.length === 0) return null;
    ctx.tableDepth += 1;
    try {
      return buildTableRows(rows, ctx);
    } finally {
      ctx.tableDepth -= 1;
    }
  }
  function buildTableRows(rows, ctx) {
    const grid = rows.map((row) => rowCells(row).map((cell) => cellInline(cell, ctx)));
    const nonEmpty = grid.filter(
      (row) => row.length > 0 && row.some((cell) => !inlineIsEmpty(cell))
    );
    if (nonEmpty.length === 0) return null;
    let header;
    let body;
    if (rows[0] && isHeaderRow(rows[0]) && nonEmpty.length >= 1) {
      header = nonEmpty[0];
      body = nonEmpty.slice(1);
    } else {
      header = nonEmpty[0];
      body = nonEmpty.slice(1);
    }
    const width = Math.max(header.length, ...body.map((r) => r.length), 1);
    const pad = (row) => {
      const copy = row.slice(0, width);
      while (copy.length < width) copy.push([]);
      return copy;
    };
    return { type: "table", header: pad(header), rows: body.map(pad) };
  }
  function detectLanguage(el2) {
    const combo = el2.querySelector(CODE_LANGUAGE_SELECTOR);
    if (combo) {
      const name = (combo.textContent ?? "").trim().toLowerCase();
      if (name) {
        const alias = CODE_LANGUAGE_ALIASES[name];
        const lang = alias === void 0 ? name : alias;
        return lang === "" ? null : lang;
      }
    }
    const candidates = [el2, ...Array.from(el2.querySelectorAll("code"))];
    for (const node of candidates) {
      const explicit = node.getAttribute("data-language") ?? node.getAttribute("lang");
      if (explicit) return explicit.toLowerCase();
      const cls = typeof node.className === "string" ? node.className : "";
      const m = /(?:language|lang|highlight)[-_]([a-z0-9+#]+)/i.exec(cls);
      if (m?.[1]) return m[1].toLowerCase();
    }
    return null;
  }
  function dedent(value) {
    const lines = value.split("\n");
    let common = null;
    for (const line of lines) {
      if (line.trim() === "") continue;
      const indent = /^[ \t]*/.exec(line)[0];
      if (common === null) {
        common = indent;
        continue;
      }
      let i = 0;
      while (i < common.length && i < indent.length && common[i] === indent[i]) i += 1;
      common = common.slice(0, i);
    }
    if (!common) return value;
    return lines.map((line) => line.startsWith(common) ? line.slice(common.length) : line).join("\n");
  }
  function buildCode(el2, ctx) {
    const lang = detectLanguage(el2);
    const source = codeTextOf(el2);
    let value = source.replace(/\r\n?/g, "\n");
    value = dedent(value.replace(/^\n+/, "").replace(/[ \t]+$/gm, "")).replace(/\s+$/, "");
    if (value === "") {
      const label = lang ? `${lang} ` : "";
      ctx?.diag.warnings.push(
        `A ${label ? `${lang} ` : ""}code block was collapsed or virtualized and could not be read.`
      );
      return {
        type: "code",
        lang,
        value: `[loopmark: this ${label}code block was collapsed in the page and could not be read]`
      };
    }
    return { type: "code", lang, value };
  }
  function isBlockLevel(el2) {
    let display = "";
    try {
      display = getComputedStyle(el2).display;
    } catch {
      display = "";
    }
    if (display) {
      return !(display === "inline" || display === "contents" || display.startsWith("inline-"));
    }
    return !INLINE_TAGS.has(el2.tagName.toUpperCase());
  }
  function codeTextOf(el2) {
    let chrome = [];
    try {
      chrome = Array.from(el2.querySelectorAll(CODE_CHROME_SELECTOR));
    } catch {
      chrome = [];
    }
    const skip = new Set(chrome);
    const parts = [];
    const breakLine = () => {
      if (parts.length === 0) return;
      if (/\n[ \t]*$/.test(parts[parts.length - 1] ?? "")) return;
      parts.push("\n");
    };
    const visit = (node) => {
      if (isText(node)) {
        const value = node.nodeValue ?? "";
        if (value.trim() === "" && /\n/.test(value)) return;
        parts.push(value.replace(/\u00a0/g, " "));
        return;
      }
      if (!isElement2(node)) return;
      if (skip.has(node)) return;
      if (node.tagName.toUpperCase() === "BR") {
        parts.push("\n");
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
        parts.push("\n");
      }
      breakLine();
    };
    visit(el2);
    return parts.join("");
  }
  function escapeText(value) {
    return value.replace(/([\\`*_[\]])/g, "\\$1").replace(/<(?=[a-zA-Z/!?])/g, "\\<").replace(/&(?=[a-zA-Z#][a-zA-Z0-9]*;)/g, "\\&");
  }
  function escapeLineStarts(text) {
    return text.split("\n").map((line) => line.replace(/^(\s*)([#>+-]|\d+[.)])(\s)/, "$1\\$2$3")).join("\n");
  }
  function wrapMark(body, mark) {
    if (body.trim() === "") return body;
    const lead = /^\s*/.exec(body)[0];
    const trail = /\s*$/.exec(body)[0];
    return `${lead}${mark}${body.slice(lead.length, body.length - trail.length)}${mark}${trail}`;
  }
  function codeFence(value, min = 1) {
    let longest = 0;
    for (const run2 of value.match(/`+/g) ?? []) longest = Math.max(longest, run2.length);
    return "`".repeat(Math.max(min, longest + 1));
  }
  function encodeUrl(url) {
    return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
  }
  function renderInline(nodes) {
    let out = "";
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          out += escapeText(node.value);
          break;
        case "code": {
          const value = node.value.trim();
          const fence = codeFence(value);
          const padded = /^`|`$/.test(value) ? ` ${value} ` : value;
          out += `${fence}${padded}${fence}`;
          break;
        }
        case "strong":
          out += wrapMark(renderInline(node.children), "**");
          break;
        case "em":
          out += wrapMark(renderInline(node.children), "_");
          break;
        case "del":
          out += wrapMark(renderInline(node.children), "~~");
          break;
        case "link": {
          const text = renderInline(node.children).trim();
          out += text ? `[${text}](${encodeUrl(node.href)})` : encodeUrl(node.href);
          break;
        }
        case "image":
          out += `![${escapeText(node.alt)}](${encodeUrl(node.src)})`;
          break;
        case "break":
          out += "\\\n";
          break;
        case "mention":
          out += escapeText(node.name);
          break;
        case "math":
          out += node.display ? `$$
${node.value}
$$` : `$${node.value}$`;
          break;
      }
    }
    return out.replace(/[ \t]+/g, " ").replace(/ ?\\\n ?/g, "\\\n");
  }
  function renderCell(nodes) {
    return renderInline(nodes).replace(/\|/g, "\\|").replace(/\\\n/g, "<br>").replace(/\n/g, " ").trim();
  }
  function indentLines(text, prefix, firstPrefix = prefix) {
    const lines = text.split("\n");
    return lines.map((line, i) => {
      const p = i === 0 ? firstPrefix : prefix;
      return line === "" ? p.replace(/\s+$/, "") : p + line;
    }).join("\n");
  }
  function renderBlocks(blocks, tight = false) {
    const parts = [];
    const kinds = [];
    const push = (text, type) => {
      parts.push(text);
      kinds.push(type);
    };
    for (const block of blocks) {
      switch (block.type) {
        case "heading": {
          const text = renderInline(block.children).replace(/\n/g, " ").trim();
          if (text) push(`${"#".repeat(block.level)} ${text}`, "heading");
          break;
        }
        case "paragraph": {
          const text = escapeLineStarts(renderInline(block.children).trim());
          if (text) push(text, "paragraph");
          break;
        }
        case "thematicBreak":
          push("---", "thematicBreak");
          break;
        case "image":
          push(`![${escapeText(block.alt)}](${encodeUrl(block.src)})`, "image");
          break;
        case "code": {
          const fence = "`".repeat(Math.max(3, longestBacktickRun(block.value) + 1));
          push(`${fence}${block.lang ?? ""}
${block.value}
${fence}`, "code");
          break;
        }
        case "quote": {
          const inner = renderBlocks(block.blocks);
          const lead = block.alert ? `> [!${block.alert}]
` : "";
          push(
            lead + inner.split("\n").map((line) => line === "" ? ">" : `> ${line}`).join("\n"),
            "quote"
          );
          break;
        }
        case "component": {
          const inner = renderBlocks(block.blocks);
          const fence = "`".repeat(Math.max(4, longestBacktickRun(inner) + 1));
          push(
            `<!-- loopmark: live Loop component, captured as a static snapshot -->
${fence}${block.kind}
${inner}
${fence}`,
            "component"
          );
          break;
        }
        case "table": {
          const cols = block.header.length;
          const head = `| ${block.header.map(renderCell).join(" | ")} |`;
          const rule = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
          const body = block.rows.map((row) => `| ${row.map(renderCell).join(" | ")} |`);
          push([head, rule, ...body].join("\n"), "table");
          break;
        }
        case "list": {
          const lines = [];
          block.items.forEach((item, index) => {
            const marker = block.ordered ? `${block.start + index}.` : "-";
            const box = item.checked === null ? "" : item.checked ? "[x] " : "[ ] ";
            const body = renderBlocks(item.blocks, true);
            const firstPrefix = `${marker} ${box}`;
            const contPrefix = " ".repeat(marker.length + 1);
            lines.push(indentLines(body, contPrefix, firstPrefix));
          });
          push(lines.join("\n"), "list");
          break;
        }
      }
    }
    let out = "";
    parts.forEach((text, i) => {
      if (i > 0) out += tight && kinds[i] === "list" && kinds[i - 1] === "paragraph" ? "\n" : "\n\n";
      out += text;
    });
    return out;
  }
  function longestBacktickRun(value) {
    let longest = 0;
    for (const run2 of value.match(/`+/g) ?? []) longest = Math.max(longest, run2.length);
    return longest;
  }
  function warnOnMissingComponents(root, blocks, diagnostics) {
    const emitted = { table: 0, code: 0 };
    const count = (list) => {
      for (const block of list) {
        if (block.type === "table") emitted.table += 1;
        else if (block.type === "code") emitted.code += 1;
        else if (block.type === "quote" || block.type === "component") count(block.blocks);
        else if (block.type === "list") for (const item of block.items) count(item.blocks);
      }
    };
    count(blocks);
    const present = {
      table: safeCount(root, TABLE_COUNT_SELECTOR),
      code: safeCount(root, ".scriptor-component-code-block")
    };
    const collapsed = diagnostics.collapsedSections;
    for (const kind of ["table", "code"]) {
      const missing = present[kind] - emitted[kind];
      if (missing === 0) continue;
      const because = collapsed.length > 0 ? `They are inside these collapsed sections: ${collapsed.join("; ")}. Expand them in Loop and run loopmark again.` : `Loop had most likely not rendered them. Scroll the whole page and run loopmark again.`;
      diagnostics.warnings.push(
        `${missing} of ${present[kind]} ${kind} block(s) could not be read. ${because}`
      );
    }
  }
  function safeCount(root, selector) {
    try {
      return root.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }
  var MAX_HEADING_LEVEL = 6;
  function shiftHeadings(blocks, by) {
    return blocks.map((block) => {
      switch (block.type) {
        case "heading": {
          const level = Math.min(block.level + by, MAX_HEADING_LEVEL);
          return { ...block, level };
        }
        case "quote":
        case "component":
          return { ...block, blocks: shiftHeadings(block.blocks, by) };
        case "list":
          return {
            ...block,
            items: block.items.map((item) => ({ ...item, blocks: shiftHeadings(item.blocks, by) }))
          };
        default:
          return block;
      }
    });
  }
  function convert({ root, meta, diagnostics }) {
    const ctx = { diag: diagnostics, imageUrls: [], depth: 0, tableDepth: 0 };
    const blocks = collectBlocks(root, ctx);
    const doc = { meta, blocks };
    let markdown = `# ${meta.title.replace(/\n/g, " ").trim() || "Untitled"}

` + renderBlocks(shiftHeadings(blocks, 1));
    warnOnMissingComponents(root, blocks, diagnostics);
    const uniqueImages = Array.from(new Set(ctx.imageUrls));
    if (uniqueImages.length > 0) {
      markdown += `

---

<!-- loopmark: ${uniqueImages.length} image(s) below are links to Loop-hosted files. They are access-controlled and will not render outside an authenticated session. -->

**Images referenced in this page**

` + uniqueImages.map((url, i) => `${i + 1}. <${url}>`).join("\n");
    }
    markdown += `

<!-- Exported from Microsoft Loop by loopmark on ${meta.exportedAt}
     Title:  ${meta.title.replace(/--+/g, "-")}
     Source: ${meta.url.replace(/--+/g, "-")}
     loopmark reads rendered DOM; it is not a Loop API and may be incomplete. -->
`;
    markdown = markdown.replace(/\n{3,}/g, "\n\n");
    return { markdown, doc, diagnostics, imageUrls: uniqueImages };
  }

  // src/ui.ts
  var BUILD = true ? "4781b660ddbf" : "dev";
  var OVERLAY_TAG = "loopmark-overlay";
  var STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
.backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(15, 18, 25, .55);
  display: flex; align-items: center; justify-content: center; padding: 4vh 4vw;
}
.panel {
  display: flex; flex-direction: column; gap: 12px;
  width: min(980px, 100%); max-height: 92vh;
  background: #fff; color: #16181d;
  border-radius: 12px; padding: 18px 20px;
  box-shadow: 0 24px 60px rgba(0,0,0,.35);
}
header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
h1 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
.sub { font-size: 12px; color: #5c6370; }
.spacer { flex: 1 1 auto; }
.status { font-size: 12px; padding: 3px 9px; border-radius: 999px; font-weight: 600; }
.status.ok { background: #e7f6ec; color: #11633a; }
.status.warn { background: #fdf3e0; color: #8a5300; }
.status.err { background: #fdecec; color: #8a1f1f; }
textarea {
  width: 100%; flex: 1 1 auto; min-height: 40vh; resize: vertical;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12.5px; line-height: 1.55; tab-size: 2;
  padding: 12px; border: 1px solid #d8dce3; border-radius: 8px;
  background: #fbfcfd; color: #16181d; white-space: pre; overflow: auto;
}
textarea:focus { outline: 2px solid #5b6ee1; outline-offset: -1px; }
.warnings { margin: 0; padding: 10px 12px; border-radius: 8px; background: #fdf3e0; color: #6b4300; font-size: 12.5px; }
.warnings ul { margin: 6px 0 0; padding-left: 18px; }
footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
button {
  font: inherit; font-size: 13px; font-weight: 550; cursor: pointer;
  padding: 7px 14px; border-radius: 7px; border: 1px solid #d8dce3; background: #fff; color: #16181d;
}
button:hover { background: #f3f5f8; }
button.primary { background: #2f3b52; border-color: #2f3b52; color: #fff; }
button.primary:hover { background: #3d4c69; }
button.close-x { border: 0; background: transparent; font-size: 18px; line-height: 1; padding: 2px 6px; color: #5c6370; }
details { font-size: 12px; color: #5c6370; }
details summary { cursor: pointer; user-select: none; }
.msg { margin: 0; font-size: 13px; line-height: 1.6; color: inherit; }
details pre { margin: 8px 0 0; padding: 10px; background: #f3f5f8; border-radius: 6px; overflow: auto; font-size: 11.5px; }
@media (prefers-color-scheme: dark) {
  .panel { background: #1b1e24; color: #e8eaed; }
  .sub, details, button.close-x { color: #9aa1ad; }
  textarea { background: #14161b; color: #e8eaed; border-color: #343a44; }
  button { background: #252932; border-color: #343a44; color: #e8eaed; }
  button:hover { background: #2e333e; }
  details pre { background: #14161b; }
}
`;
  function removeExistingOverlay() {
    for (const node of Array.from(document.querySelectorAll(OVERLAY_TAG))) node.remove();
  }
  async function copyText(text, selectable) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return "clipboard-api";
      }
    } catch {
    }
    const area = selectable ?? (() => {
      const scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.setAttribute("aria-hidden", "true");
      scratch.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
      document.body.appendChild(scratch);
      return scratch;
    })();
    try {
      area.focus({ preventScroll: true });
      area.select();
      area.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      return ok ? "exec-command" : "failed";
    } catch {
      return "failed";
    } finally {
      if (!selectable) area.remove();
    }
  }
  function download(text, title) {
    const safe = (title || "loop-page").replace(/[^\w\s.-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "loop-page";
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}.md`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e4);
  }
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) node.append(child);
    return node;
  }
  function truncationWarning(markdown, diagnostics) {
    const { elementsVisited } = diagnostics;
    if (elementsVisited < 200) return null;
    if (markdown.length >= elementsVisited) return null;
    return `Walked ${elementsVisited.toLocaleString()} elements but produced only ${markdown.length.toLocaleString()} characters. The output may be incomplete \u2014 see Details, and check src/selectors.ts.`;
  }
  function showOverlay(options) {
    const { markdown, title, diagnostics, autoCopy } = options;
    removeExistingOverlay();
    const host = document.createElement(OVERLAY_TAG);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(el("style", { textContent: STYLE }));
    const lines = markdown.split("\n").length;
    const statusText = {
      "clipboard-api": "Copied to clipboard",
      "exec-command": "Copied to clipboard",
      failed: "Not copied \u2014 press Copy, or Ctrl/Cmd+C"
    };
    const status = el("span", {
      className: `status ${autoCopy === "failed" ? "warn" : "ok"}`,
      textContent: statusText[autoCopy]
    });
    const textarea = el("textarea", { value: markdown, spellcheck: false });
    textarea.setAttribute("readonly", "readonly");
    textarea.setAttribute("aria-label", "Exported Markdown");
    const closeButton = el("button", { className: "close-x", textContent: "\u2715", title: "Close (Esc)" });
    closeButton.setAttribute("aria-label", "Close");
    const header = el("header", {}, [
      el("h1", { textContent: "loopmark" }),
      el("span", {
        className: "sub",
        textContent: `${lines.toLocaleString()} lines \xB7 ${markdown.length.toLocaleString()} characters`
      }),
      el("div", { className: "spacer" }),
      status,
      closeButton
    ]);
    const warnings = [...diagnostics.warnings];
    const truncation = truncationWarning(markdown, diagnostics);
    if (truncation) warnings.push(truncation);
    const copyButton = el("button", { className: "primary", textContent: "Copy Markdown" });
    const downloadButton = el("button", { textContent: "Download .md" });
    const closeFooter = el("button", { textContent: "Close" });
    const details = el("details", {}, [
      el("summary", { textContent: "Details" }),
      el("pre", {
        textContent: [
          `loopmark build        : ${BUILD}`,
          `content root strategy : ${diagnostics.contentRootStrategy}`,
          `elements visited      : ${diagnostics.elementsVisited}`,
          `shadow roots pierced  : ${diagnostics.shadowRootsPierced}`,
          `disclosures expanded  : ${diagnostics.expandedWidgets}`,
          `unrecognized elements : ${diagnostics.unrecognizedElements}`,
          `unrecognized tags     : ${diagnostics.unrecognizedSamples.join(", ") || "(none)"}`
        ].join("\n")
      })
    ]);
    const panel = el("div", { className: "panel" }, [header]);
    if (warnings.length > 0) {
      panel.append(
        el("div", { className: "warnings" }, [
          el("strong", { textContent: "Heads up" }),
          el("ul", {}, warnings.map((w) => el("li", { textContent: w })))
        ])
      );
    }
    panel.append(
      textarea,
      el("footer", {}, [
        copyButton,
        downloadButton,
        el("div", { className: "spacer" }),
        details,
        closeFooter
      ])
    );
    const backdrop = el("div", { className: "backdrop" }, [panel]);
    shadow.append(backdrop);
    const close = () => {
      document.removeEventListener("keydown", onKeydown, true);
      host.remove();
    };
    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }
    document.addEventListener("keydown", onKeydown, true);
    shadow.addEventListener("keydown", onKeydown, true);
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close();
    });
    closeButton.addEventListener("click", close);
    closeFooter.addEventListener("click", close);
    copyButton.addEventListener("click", () => {
      void copyText(markdown, textarea).then((outcome) => {
        copyButton.textContent = outcome === "failed" ? "Press Ctrl/Cmd+C" : "Copied";
        status.className = `status ${outcome === "failed" ? "warn" : "ok"}`;
        status.textContent = statusText[outcome];
        if (outcome === "failed") {
          textarea.focus({ preventScroll: true });
          textarea.select();
        }
        setTimeout(() => {
          copyButton.textContent = "Copy Markdown";
        }, 2e3);
      });
    });
    downloadButton.addEventListener("click", () => download(markdown, title));
    document.body.appendChild(host);
    textarea.focus({ preventScroll: true });
    textarea.select();
  }
  function showMessage({ heading, message, detail, action, busy }) {
    removeExistingOverlay();
    const host = document.createElement(OVERLAY_TAG);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(el("style", { textContent: STYLE }));
    const closeButton = el("button", { className: "primary", textContent: "Close" });
    const panel = el("div", { className: "panel" }, [
      el("header", {}, [el("h1", { textContent: heading })]),
      el("p", { className: "msg", textContent: message })
    ]);
    if (detail) {
      panel.append(el("details", {}, [
        el("summary", { textContent: "Details" }),
        el("pre", { textContent: detail })
      ]));
    }
    const footerNodes = [el("div", { className: "spacer" })];
    if (action) {
      const actionButton = el("button", { textContent: action.label });
      actionButton.addEventListener("click", () => {
        close();
        action.onClick();
      });
      footerNodes.push(actionButton);
    }
    if (!busy) footerNodes.push(closeButton);
    panel.append(el("footer", {}, footerNodes));
    const backdrop = el("div", { className: "backdrop" }, [panel]);
    shadow.append(backdrop);
    const close = () => {
      document.removeEventListener("keydown", onKeydown, true);
      host.remove();
    };
    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }
    document.addEventListener("keydown", onKeydown, true);
    closeButton.addEventListener("click", close);
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close();
    });
    document.body.appendChild(host);
    if (!busy) closeButton.focus({ preventScroll: true });
  }

  // src/main.ts
  async function run() {
    showMessage({
      heading: "loopmark",
      message: "Reading the page\u2026 scrolling to make Loop render everything.",
      busy: true
    });
    const diagnostics = {
      contentRootStrategy: "unknown",
      shadowRootsPierced: 0,
      unrecognizedElements: 0,
      unrecognizedSamples: [],
      expandedWidgets: 0,
      elementsVisited: 0,
      droppedDataImages: 0,
      collapsedSections: [],
      warnings: []
    };
    let { root, strategy, rejected } = findContentRoot(document);
    diagnostics.contentRootStrategy = strategy;
    if (strategy === "fallback-body") {
      diagnostics.warnings.push(
        "Could not identify the Loop page content container, so the whole page was exported. Output will contain navigation and UI text. See src/selectors.ts."
      );
    }
    diagnostics.expandedWidgets = await expandCollapsed(root);
    let scrolled = await forceRender(root, document);
    for (let pass = 1; pass < PREPARE_PASSES; pass += 1) {
      const opened = await expandCollapsed(root);
      if (opened === 0) break;
      diagnostics.expandedWidgets += opened;
      scrolled = await forceRender(root, document) || scrolled;
    }
    if (!scrolled) {
      diagnostics.warnings.push(
        "No scrollable container was found, so virtualized content could not be forced to render. If the page is long, the export may be truncated."
      );
    }
    if (!root.isConnected) {
      ({ root, strategy, rejected } = findContentRoot(document));
      diagnostics.contentRootStrategy = `${strategy} (re-resolved)`;
    }
    const stats = { elementsVisited: 0, shadowRootsPierced: 0 };
    walkComposed(root, () => void 0, stats);
    diagnostics.elementsVisited = stats.elementsVisited;
    diagnostics.shadowRootsPierced = stats.shadowRootsPierced;
    if (stats.shadowRootsPierced === 0 && countShadowRoots(document.body) === 0) {
      diagnostics.warnings.push(
        "No open shadow roots were found anywhere on the page. If content is missing, Loop may have switched to closed shadow roots, which no bookmarklet can read."
      );
    }
    const title = findTitle(document);
    const result = convert({
      root,
      meta: { title, url: location.href, exportedAt: (/* @__PURE__ */ new Date()).toISOString() },
      diagnostics
    });
    if (result.markdown.trim().length < 80) {
      diagnostics.warnings.push(
        `Almost nothing was extracted. Content-root candidates tried: ${rejected.join("; ") || "none"}.`
      );
    }
    const autoCopy = await copyText(result.markdown);
    showOverlay({ markdown: result.markdown, title, diagnostics, autoCopy });
  }
  function main() {
    try {
      if (!isLoopHost(location.host)) {
        showMessage({
          heading: "This does not look like a Loop page",
          message: `loopmark expects to run on ${LOOP_HOSTS.join(" or ")}. You are on ${location.host}. You can try anyway -- it reads the DOM either way and changes nothing -- but the selectors are tuned for Loop.`,
          action: { label: "Export anyway", onClick: () => void guard(run) }
        });
        return;
      }
      void guard(run);
    } catch (error) {
      reportFailure(error);
    }
  }
  async function guard(fn) {
    try {
      await fn();
    } catch (error) {
      reportFailure(error);
    }
  }
  function reportFailure(error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}

${error.stack ?? ""}` : String(error);
    showMessage({
      heading: "loopmark hit an error",
      message: "Nothing on the page was changed. This is almost always a Loop UI change that broke a selector -- see src/selectors.ts, and re-run spikes/probe.js to find the new markup.",
      detail
    });
  }
  removeExistingOverlay();
  main();
})();
