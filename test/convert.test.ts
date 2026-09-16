import { beforeEach, describe, expect, it } from 'vitest';
import { convertElement, escapeText, renderInline, resetMatchers } from '../src/convert.js';
import { body, fixture, html } from './helpers.js';

beforeEach(() => {
  document.body.innerHTML = '';
  resetMatchers();
});

// ---------------------------------------------------------------------------
// The regression that matters most (acceptance criterion 4).
// ---------------------------------------------------------------------------

describe('headings', () => {
  it('promotes heading-marked list items out of the list', () => {
    const md = body(fixture('heading-in-list-item.html'));

    expect(md).toContain('## Section One');
    expect(md).toContain('### Subsection');
    expect(md).toContain('- First real bullet');
    expect(md).toContain('- Second real bullet');

    // No line may be a bullet whose content is a heading. This is the exact
    // artifact that Loop's own copy-paste produces.
    expect(md).not.toMatch(/^\s*[-*+]\s+#/m);
  });

  it('keys off aria-level ahead of tag name', () => {
    // An <h1> that ARIA says is level 3 is a level-3 heading: the accessibility
    // tree reflects what the author chose, the tag reflects editor internals.
    const md = body(html('<h1 role="heading" aria-level="3">Mislabelled</h1>'));
    expect(md).toBe('### Mislabelled');
  });

  it('falls back to tag name when aria-level is absent', () => {
    expect(body(html('<h2>Plain</h2>'))).toBe('## Plain');
  });

  it('defaults an unranked ARIA heading to level 3', () => {
    expect(body(html('<div role="heading">Unranked</div>'))).toBe('### Unranked');
  });

  it('clamps out-of-range aria-level values', () => {
    expect(body(html('<div role="heading" aria-level="9">Too deep</div>'))).toBe('### Too deep');
  });
});

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

describe('lists', () => {
  it('nests by real structure and honours ordered start', () => {
    expect(body(fixture('nested-list.html'))).toBe(
      [
        '- Alpha',
        '  - Alpha one',
        '  - Alpha two',
        '    3. Deep item A',
        '    4. Deep item B',
        '- Beta',
      ].join('\n'),
    );
  });

  it('renders checklists from input state and aria-checked', () => {
    expect(body(fixture('checklist.html'))).toBe(
      [
        '- [x] Write the probe',
        '- [ ] Run the probe',
        '- [x] Aria-flavored, done',
        '- [ ] Aria-flavored, pending',
      ].join('\n'),
    );
  });

  it('looks through presentational wrappers to find list items', () => {
    const md = body(
      html('<ul><div role="presentation"><li>Wrapped</li></div><li>Direct</li></ul>'),
    );
    expect(md).toBe('- Wrapped\n- Direct');
  });
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

describe('tables', () => {
  it('produces valid GFM, escaping pipes and padding ragged rows', () => {
    expect(body(fixture('table.html'))).toBe(
      [
        '| Name | Owner \\| Team | Status |',
        '| --- | --- | --- |',
        '| widget-api | Platform | Live |',
        '| gadget-api | Platform |  |',
      ].join('\n'),
    );
  });

  it('handles ARIA-role tables with no table tags', () => {
    expect(body(fixture('aria-table.html'))).toBe(
      [
        '| Key | Value |',
        '| --- | --- |',
        '| region | us-east |',
        '| replicas | 3 |',
      ].join('\n'),
    );
  });

  it('every row has the same column count as the header', () => {
    const md = body(fixture('table.html'));
    // Split on unescaped pipes only -- an escaped `\\|` is cell content.
    const counts = md.split('\n').map((line) => line.split(/(?<!\\)\|/).length);
    expect(new Set(counts).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Inline formatting
// ---------------------------------------------------------------------------

describe('inline formatting', () => {
  it('converts marks, links, code, breaks, mentions and images', () => {
    const md = body(fixture('formatting.html'));

    expect(md).toContain('**bold**');
    expect(md).toContain('_italic_');
    expect(md).toContain('~~struck~~');
    expect(md).toContain('`inline_code()`');
    expect(md).toContain('**Bold with _nested italic_ inside**');
    expect(md).toContain('**Styled bold**');
    expect(md).toContain('_styled italic_');
    expect(md).toContain('[link with query params](https://example.invalid/docs?a=1&b=2)');
    expect(md).toContain('](https://example.invalid/a%28b%29c)');
    expect(md).toContain('Line one\\\nline two');
    expect(md).toContain('Person A please review.');
    expect(md).toContain('![A diagram](https://example.invalid/img/diagram.png)');
    expect(md).toContain('```ts\nconst x: number = 1;');
  });

  it('never emits a run of three or more asterisks', () => {
    // `****text****` is the signature of double-wrapping inherited font-weight.
    expect(body(fixture('formatting.html'))).not.toMatch(/\*{3,}/);
  });

  it('does not re-wrap text that merely inherits bold from an ancestor', () => {
    const md = body(html('<p><strong>outer <span>inner</span></strong></p>'));
    expect(md).toBe('**outer inner**');
  });

  it('hoists whitespace outside emphasis delimiters', () => {
    // `** bold **` is not bold in GFM; the delimiter must hug a non-space.
    expect(renderInline([{ type: 'strong', children: [{ type: 'text', value: ' bold ' }] }]))
      .toBe(' **bold** ');
  });

  it('sizes inline code fences around embedded backticks', () => {
    expect(renderInline([{ type: 'code', value: 'a ` b' }])).toBe('``a ` b``');
    expect(renderInline([{ type: 'code', value: '`x`' }])).toBe('`` `x` ``');
  });

  it('renders a bare link when it has no text', () => {
    expect(body(html('<p><a href="https://example.invalid/x"></a></p>')))
      .toBe('https://example.invalid/x');
  });
});

describe('escaping', () => {
  it('escapes Markdown syntax characters in text', () => {
    expect(escapeText('a * b _ c [d] `e`')).toBe('a \\* b \\_ c \\[d\\] \\`e\\`');
  });

  it('only escapes < when it could open a tag', () => {
    expect(escapeText('3 < 5 but <b> is a tag')).toBe('3 < 5 but \\<b> is a tag');
  });

  it('escapes line-leading characters that would start another block', () => {
    expect(body(html('<p>- not a list</p>'))).toBe('\\- not a list');
    expect(body(html('<p>1. not ordered</p>'))).toBe('\\1. not ordered');
    expect(body(html('<p># not a heading</p>'))).toBe('\\# not a heading');
  });
});

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

describe('callouts', () => {
  it('maps Loop callouts onto GitHub Alerts and leaves quotes plain', () => {
    const md = body(fixture('callout.html'));
    expect(md).toContain('> [!WARNING]\n> Do not deploy on a Friday.');
    expect(md).toContain('> [!NOTE]\n> This is a plain note.');
    expect(md).toContain('> [!CAUTION]\n> This will drop the table.');
    expect(md).toContain('> An ordinary quotation.');
    expect(md).not.toContain('> [!NOTE]\n> An ordinary quotation.');
  });
});

describe('code blocks', () => {
  it('preserves internal whitespace and detects the language', () => {
    const md = body(fixture('formatting.html'));
    expect(md).toContain("```ts\nconst x: number = 1;\nif (x) {\n  console.log('hi');\n}\n```");
  });

  it('widens the fence when the content contains a triple backtick', () => {
    const el = html('<pre><code>```\nnested\n```</code></pre>');
    expect(body(el)).toBe('````\n```\nnested\n```\n````');
  });
});

describe('Loop components', () => {
  it('snapshots a live component into a labelled fence with a provenance note', () => {
    const md = body(fixture('component.html'));
    expect(md).toContain('<!-- loopmark: live Loop component, captured as a static snapshot -->');
    expect(md).toContain('````loop-voting-table');
    expect(md).toContain('#### Pick a date');
    expect(md).toContain('- Option one');
  });
});

describe('chrome exclusion', () => {
  it('drops toolbars, comment threads, presence layers and aria-hidden rails', () => {
    const md = body(fixture('chrome-noise.html'));
    expect(md).toBe('Real content survives.');
  });
});

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

describe('document assembly', () => {
  it('emits a title, an image footnote and an HTML-comment provenance block', () => {
    const el = html('<p>Body</p><p><img src="https://example.invalid/a.png" alt="A"></p>');
    const result = convertElement(el, {
      title: 'My Page',
      url: 'https://example.invalid/page',
      exportedAt: '2026-01-02T03:04:05.000Z',
    });

    expect(result.markdown.startsWith('# My Page\n')).toBe(true);
    expect(result.imageUrls).toEqual(['https://example.invalid/a.png']);
    expect(result.markdown).toContain('**Images referenced in this page**');
    expect(result.markdown).toContain('access-controlled');
    expect(result.markdown).toContain('<!-- Exported from Microsoft Loop by loopmark on 2026-01-02T03:04:05.000Z');
    expect(result.markdown).toContain('Source: https://example.invalid/page');
  });

  it('omits the image footnote when there are no images', () => {
    const result = convertElement(html('<p>Body</p>'));
    expect(result.markdown).not.toContain('Images referenced in this page');
  });

  it('never leaves three consecutive newlines', () => {
    const result = convertElement(fixture('formatting.html'));
    expect(result.markdown).not.toMatch(/\n{3}/);
  });

  it('records unrecognized custom elements for diagnostics', () => {
    const el = html('<x-unknown-widget><p>Text</p></x-unknown-widget>');
    const result = convertElement(el);
    expect(result.diagnostics.unrecognizedSamples).toContain('x-unknown-widget');
    expect(result.markdown).toContain('Text');
  });
});
