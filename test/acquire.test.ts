import { beforeEach, describe, expect, it } from 'vitest';
import {
  composedChildren,
  composedText,
  countShadowRoots,
  expandCollapsed,
  findContentRoot,
  findTitle,
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
