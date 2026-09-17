import { beforeEach, describe, expect, it } from 'vitest';
import {
  composedChildren,
  composedParent,
  composedText,
  countShadowRoots,
  expandCollapsed,
  findContentRoot,
  findScroller,
  findTitle,
  forceRender,
  isSafeToClick,
  pierceQuerySelectorAll,
  walkComposed,
} from '../src/acquire.js';
import { convertElement, resetMatchers } from '../src/convert.js';

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = '';
  resetMatchers();
});

/** Build `<div>` with an open shadow root containing `shadowHtml`. */
function shadowHost(shadowHtml: string, lightHtml = ''): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  host.innerHTML = lightHtml;
  host.attachShadow({ mode: 'open' }).innerHTML = shadowHtml;
  return host;
}

describe('composed-tree traversal', () => {
  it('sees text inside an open shadow root', () => {
    const host = shadowHost('<p>inside shadow</p>');
    expect(composedText(host)).toBe('inside shadow');
    expect(host.textContent).toBe('');
  });

  it('visits slotted light-DOM content exactly once', () => {
    // The trap: naively recursing into shadowRoot *in addition to* the light
    // children visits slotted nodes twice, duplicating the text.
    const host = shadowHost('<b>before </b><slot></slot><b> after</b>', '<span>slotted</span>');
    expect(composedText(host)).toBe('before slotted after');

    const spans = pierceQuerySelectorAll(host, 'span');
    expect(spans.length).toBe(1);
  });

  it('falls back to slot content when nothing is assigned', () => {
    const host = shadowHost('<slot>fallback</slot>');
    expect(composedText(host)).toBe('fallback');
  });

  it('descends through nested shadow roots', () => {
    const outer = shadowHost('<div id="mid"></div>');
    const mid = outer.shadowRoot!.querySelector('#mid') as HTMLElement;
    mid.attachShadow({ mode: 'open' }).innerHTML = '<p>deep</p>';

    expect(composedText(outer)).toBe('deep');
    expect(countShadowRoots(outer)).toBe(2);
  });

  it('cannot see into a closed shadow root', () => {
    // Documented limitation, asserted so it is a deliberate fact, not a surprise.
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.attachShadow({ mode: 'closed' }).innerHTML = '<p>hidden</p>';
    expect(composedText(host)).toBe('');
    expect(countShadowRoots(host)).toBe(0);
  });

  it('prunes a subtree when the visitor returns false', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="skip"><p>no</p></div><p>yes</p>';
    document.body.appendChild(host);

    let text = '';
    walkComposed(host, (node) => {
      if (node.nodeType === 1 && (node as Element).classList?.contains('skip')) return false;
      if (node.nodeType === 3) text += node.nodeValue;
      return undefined;
    });
    expect(text).toBe('yes');
  });

  it('exposes shadow children instead of light children for a host', () => {
    const host = shadowHost('<i>s</i>', '<em>l</em>');
    const kids = composedChildren(host).filter((n) => n.nodeType === 1) as Element[];
    expect(kids.map((k) => k.tagName)).toEqual(['I']);
  });
});

describe('converter integration with shadow DOM', () => {
  it('converts a heading rendered inside a shadow root', () => {
    const host = shadowHost('<div role="heading" aria-level="2">Shadow heading</div><p>Body</p>');
    const md = convertElement(host).markdown;
    expect(md).toContain('## Shadow heading');
    expect(md).toContain('Body');
  });

  it('keeps slotted content in render order, not DOM order', () => {
    const host = shadowHost('<p>one</p><slot></slot><p>three</p>', '<p>two</p>');
    const md = convertElement(host).markdown;
    const body = md.replace(/^# .*\n\n/, '');
    expect(body.indexOf('one')).toBeLessThan(body.indexOf('two'));
    expect(body.indexOf('two')).toBeLessThan(body.indexOf('three'));
  });
});

describe('findContentRoot', () => {
  it('prefers a contenteditable region over the body', () => {
    document.body.innerHTML = `
      <div role="main">
        <div contenteditable="true">${'Plenty of real page content here. '.repeat(3)}</div>
      </div>`;
    const result = findContentRoot(document);
    expect(result.strategy).toBe('main-contenteditable');
    expect(result.root.getAttribute('contenteditable')).toBe('true');
  });

  it('skips candidates that match but carry too little text', () => {
    document.body.innerHTML = `
      <div contenteditable="true">hi</div>
      <main>${'A genuinely long body of page content. '.repeat(3)}</main>`;
    const result = findContentRoot(document);
    expect(result.strategy).toBe('main-element');
    expect(result.rejected.some((r) => r.startsWith('contenteditable-true'))).toBe(true);
  });

  it('degrades to body rather than returning nothing', () => {
    document.body.innerHTML = '<span>bare</span>';
    expect(findContentRoot(document).strategy).toBe('fallback-body');
  });

  it('climbs from paragraph blocks when every named candidate is gone', () => {
    // Simulates Microsoft renaming every page-container class at once.
    document.body.innerHTML = `
      <div class="wrapper-xyz"><div class="inner-abc">
        <div class="scriptor-paragraph">One paragraph of content here.</div>
        <div class="scriptor-paragraph">Two paragraphs of content here.</div>
        <div class="scriptor-paragraph">Three paragraphs of content here.</div>
      </div></div>`;
    const result = findContentRoot(document);
    expect(result.strategy).toBe('paragraph-ancestor');
    expect((result.root as HTMLElement).className).toBe('inner-abc');
  });

  it('steps across a shadow boundary when finding a composed parent', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<p id="deep">x</p>';
    const p = root.getElementById('deep')!;
    expect(p.parentElement).toBeNull();
    expect(composedParent(p)).toBe(host);
  });

  it('picks the largest of several matching candidates', () => {
    document.body.innerHTML = `
      <div contenteditable="true">short title field</div>
      <div contenteditable="true">${'The actual document body text. '.repeat(5)}</div>`;
    const result = findContentRoot(document);
    expect(result.root.textContent).toContain('The actual document body text.');
  });
});

describe('findTitle', () => {
  it('uses the first level-1 ARIA heading in main', () => {
    document.body.innerHTML =
      '<div role="main"><div role="heading" aria-level="1">Real Title</div></div>';
    expect(findTitle(document)).toBe('Real Title');
  });

  it('strips the Loop suffix from document.title as a fallback', () => {
    document.title = 'Sprint Notes | Microsoft Loop';
    expect(findTitle(document)).toBe('Sprint Notes');
  });

  it('never returns an empty string', () => {
    document.title = '';
    expect(findTitle(document)).toBe('Untitled');
  });
});

describe('click safety', () => {
  it('vetoes anything that looks like a real action', () => {
    const make = (html: string): Element => {
      const d = document.createElement('div');
      d.innerHTML = html;
      return d.firstElementChild!;
    };
    expect(isSafeToClick(make('<button class="collapseToggle">Show</button>'))).toBe(true);
    expect(isSafeToClick(make('<button aria-label="Delete section">x</button>'))).toBe(false);
    expect(isSafeToClick(make('<button aria-label="Share page">x</button>'))).toBe(false);
    expect(isSafeToClick(make('<button>Add comment</button>'))).toBe(false);
    expect(isSafeToClick(make('<button class="expandChevron" title="Move up">x</button>'))).toBe(false);
  });

  it('clicks only allowlisted collapsed disclosures', async () => {
    document.body.innerHTML = `
      <button id="ok" class="collapseToggle" aria-expanded="false">Show more</button>
      <button id="danger" class="collapseToggle" aria-expanded="false" aria-label="Delete block">x</button>
      <button id="generic" aria-expanded="false">Something</button>
      <button id="open" class="collapseToggle" aria-expanded="true">Already open</button>`;

    const clicked: string[] = [];
    for (const id of ['ok', 'danger', 'generic', 'open']) {
      document.getElementById(id)!.addEventListener('click', () => clicked.push(id));
    }

    const count = await expandCollapsed(document.body);
    expect(clicked).toEqual(['ok']);
    expect(count).toBe(1);
  });

  it('is idempotent once aria-expanded flips to true', async () => {
    document.body.innerHTML =
      '<button class="collapseToggle" aria-expanded="false">Show</button>';
    const btn = document.querySelector('button')!;
    btn.addEventListener('click', () => btn.setAttribute('aria-expanded', 'true'));

    expect(await expandCollapsed(document.body)).toBe(1);
    expect(await expandCollapsed(document.body)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Finding the scroller.
//
// This is the bug that made `forceRender` a no-op on live Loop: the scroller
// is an <article> three levels ABOVE the content root, and `.scriptor-canvas`
// in between is `overflow: hidden` despite its `scriptor-styled-scrollbar`
// class. Searching only inside the content root found nothing, so nothing was
// ever scrolled and every virtualized block went missing without explanation.
//
// jsdom performs no layout, so scroll metrics are stubbed per element.
// ---------------------------------------------------------------------------

/** Give an element the scroll metrics jsdom will not compute. */
const withScrollMetrics = (el: Element, scrollHeight: number, clientHeight: number): void => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
};

describe('findScroller', () => {
  /** The real Loop shape: scrolling <article> > hidden canvas > content root. */
  const loopShape = (): { root: Element; article: Element; canvas: Element } => {
    document.body.innerHTML = `
      <article style="overflow-y: auto">
        <div class="scriptor-canvas scriptor-styled-scrollbar" style="overflow: hidden">
          <div class="scriptor-pageContainer">
            <div class="scriptor-paragraph">content</div>
          </div>
        </div>
      </article>`;
    const article = document.querySelector('article')!;
    const canvas = document.querySelector('.scriptor-canvas')!;
    const root = document.querySelector('.scriptor-pageContainer')!;
    withScrollMetrics(article, 8000, 900);
    // The canvas is tall but clips rather than scrolls -- the decoy.
    withScrollMetrics(canvas, 8000, 900);
    withScrollMetrics(root, 8000, 8000);
    return { root, article, canvas };
  };

  it('finds a scroller that is an ancestor of the content root', () => {
    const { root, article } = loopShape();
    expect(findScroller(root, document)).toBe(article);
  });

  it('does not mistake an overflow:hidden wrapper for the scroller', () => {
    const { root, canvas } = loopShape();
    expect(findScroller(root, document)).not.toBe(canvas);
  });

  it('ignores a few pixels of rounding overflow', () => {
    document.body.innerHTML = `
      <div id="outer" style="overflow-y: auto"><div id="root">content</div></div>`;
    const outer = document.getElementById('outer')!;
    withScrollMetrics(outer, 908, 900);
    expect(findScroller(document.getElementById('root')!, document)).toBeNull();
  });

  it('falls back to a scrolling descendant when no ancestor scrolls', () => {
    document.body.innerHTML = `
      <div id="root"><div id="pane" style="overflow-y: scroll">content</div></div>`;
    const pane = document.getElementById('pane')!;
    withScrollMetrics(pane, 5000, 600);
    expect(findScroller(document.getElementById('root')!, document)).toBe(pane);
  });

  it('returns null when nothing scrolls, rather than guessing', () => {
    document.body.innerHTML = '<div id="root"><p>short</p></div>';
    expect(findScroller(document.getElementById('root')!, document)).toBeNull();
  });
});

describe('forceRender', () => {
  it('scrolls an ancestor scroller and restores its position', async () => {
    document.body.innerHTML = `
      <article style="overflow-y: auto">
        <div class="scriptor-pageContainer">content</div>
      </article>`;
    const article = document.querySelector('article')!;
    const root = document.querySelector('.scriptor-pageContainer')!;
    withScrollMetrics(article, 8000, 900);

    const seen: number[] = [];
    let position = 120;
    Object.defineProperty(article, 'scrollTop', {
      configurable: true,
      get: () => position,
      set: (value: number) => {
        position = value;
        seen.push(value);
      },
    });

    expect(await forceRender(root, document)).toBe(true);
    expect(seen.length).toBeGreaterThan(1);
    expect(Math.max(...seen)).toBe(8000);
    // The user's scroll position is not a side effect anyone asked for.
    expect(position).toBe(120);
  });

  it('reports false when there is nothing to scroll', async () => {
    document.body.innerHTML = '<div id="root">short</div>';
    expect(await forceRender(document.getElementById('root')!, document)).toBe(false);
  });
});

describe('expanding Loop code blocks', () => {
  it('considers "Show more lines" safe to click', () => {
    document.body.innerHTML =
      '<button type="button" aria-label="Show more lines"><span>Show more lines</span></button>';
    expect(isSafeToClick(document.querySelector('button')!)).toBe(true);
  });

  it('clicks it, so a virtualized code block can be read', async () => {
    document.body.innerHTML = `
      <div class="scriptor-pageContainer">
        <div class="scriptor-component-code-block">
          <button type="button" aria-label="Show more lines">Show more lines</button>
        </div>
      </div>`;
    const root = document.querySelector('.scriptor-pageContainer')!;
    const button = document.querySelector('button')!;
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });
    expect(await expandCollapsed(root)).toBeGreaterThan(0);
    expect(clicks).toBe(1);
  });

  it('still refuses anything destructive or outward-facing', () => {
    for (const label of ['Delete row', 'Share', 'Add a comment', 'Sign out', 'New page']) {
      document.body.innerHTML = `<button aria-expanded="false" class="expand" aria-label="${label}"></button>`;
      expect(isSafeToClick(document.querySelector('button')!)).toBe(false);
    }
  });
});

describe('expansion is idempotent within a pass', () => {
  it('clicks an element once even when several allowlist rules match it', async () => {
    // `[class*="collaps"]` and `[class*="expand"]` both match this button.
    // Clicking a toggle twice closes what the first click opened.
    document.body.innerHTML = `
      <div id="root">
        <button aria-expanded="false" class="collapsible expander" aria-label="Show section"></button>
      </div>`;
    const button = document.querySelector('button')!;
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
      button.setAttribute('aria-expanded', 'true');
    });
    await expandCollapsed(document.getElementById('root')!);
    expect(clicks).toBe(1);
  });
});
