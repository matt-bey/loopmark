import { beforeEach, describe, expect, it } from 'vitest';
import { convertElement, escapeText, renderInline, resetMatchers, resolveHref, dedent } from '../src/convert.js';
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

// ---------------------------------------------------------------------------
// Loop's actual ("Scriptor") markup
// ---------------------------------------------------------------------------

describe('Loop Scriptor markup', () => {
  it('recognizes headings expressed only as a class name', () => {
    const md = body(fixture('loop-markup.html'));
    expect(md).toContain('## Background');
    expect(md).not.toMatch(/^\s*[-*+]\s+#/m);
  });

  it('extracts link destinations from the title attribute', () => {
    // Loop renders <span role="link" title="URL\nClick to follow link">, not
    // <a href>. Missing this drops every URL while the output still looks fine.
    const md = body(fixture('loop-markup.html'));
    expect(md).toContain('[the spec](https://example.invalid/spec)');
    expect(md).toContain('[the RFC](https://example.invalid/rfc)');
    expect(md).not.toContain('Click to follow link');
  });

  it('does not turn an ordinary tooltip into a link', () => {
    expect(body(fixture('loop-markup.html'))).toContain('A tooltip is not a link.');
  });

  it('joins soft lines within a paragraph with a hard break, not a blank line', () => {
    const md = body(fixture('loop-markup.html'));
    expect(md).toContain('First line of the paragraph\\\nsecond line of the same paragraph.');
  });

  it('does not emit a stray leading hard break from pretty-printed markup', () => {
    // The whitespace text node before the first <div class="scriptor-line">
    // must not count as content worth breaking after.
    expect(body(fixture('loop-markup.html'))).not.toMatch(/^\\$/m);
  });

  it('maps a data-type callout onto the matching GitHub Alert', () => {
    expect(body(fixture('loop-markup.html')))
      .toContain('> [!WARNING]\n> Rotate the key before the cutover.');
  });

  it('reads inline code, code blocks and dividers from class names', () => {
    const md = body(fixture('loop-markup.html'));
    expect(md).toContain('`settings.json`');
    expect(md).toContain('```bash\necho one\n```');
    expect(md).toContain('\n---\n');
  });

  it('gathers standalone task items into one checklist', () => {
    const md = body(fixture('loop-markup.html'));
    expect(md).toContain('- [x] Ship the probe\n- [ ] Verify selectors');
  });

  it('drops the page header chrome', () => {
    expect(body(fixture('loop-markup.html'))).not.toContain('presence avatars');
  });

  it('resolves aria-owns list items and does not duplicate the hidden copy', () => {
    const md = body(fixture('aria-owns-list.html'));
    expect(md).toBe('- Owned one\n- Owned two');
    expect(md.match(/Owned one/g)!.length).toBe(1);
  });
});

describe('resolveHref', () => {
  it('prefers a real href, then data-href, then a URL-shaped title', () => {
    const make = (attrs: string): Element => {
      const d = document.createElement('div');
      d.innerHTML = `<span ${attrs}>x</span>`;
      return d.firstElementChild!;
    };
    expect(resolveHref(make('href="https://example.invalid/a"'))).toBe('https://example.invalid/a');
    expect(resolveHref(make('data-href="https://example.invalid/b"'))).toBe('https://example.invalid/b');
    expect(resolveHref(make('title="https://example.invalid/c&#10;Click to follow link"')))
      .toBe('https://example.invalid/c');
    expect(resolveHref(make('title="mailto:someone@example.invalid"')))
      .toBe('mailto:someone@example.invalid');
    expect(resolveHref(make('title="Just a tooltip"'))).toBe('');
    expect(resolveHref(make(''))).toBe('');
  });
});

describe('dedent', () => {
  it('removes the indentation HTML added but keeps relative indentation', () => {
    expect(dedent('    if (x) {\n      go();\n    }')).toBe('if (x) {\n  go();\n}');
  });

  it('ignores blank lines when computing the common prefix', () => {
    expect(dedent('  a\n\n  b')).toBe('a\n\nb');
  });

  it('is a no-op when a line starts at column zero', () => {
    expect(dedent('a\n  b')).toBe('a\n  b');
  });
});

// ---------------------------------------------------------------------------
// Real Loop table markup, captured from a saved page on 2026-09-16.
//
// Every assertion here corresponds to a defect the synthetic fixtures missed,
// because they encoded what Loop's markup was assumed to look like rather than
// what it is.
// ---------------------------------------------------------------------------

describe('Loop tables (real markup)', () => {
  const md = (): string => body(fixture('loop-table.html'));

  it('emits a GFM pipe table rather than flattened text', () => {
    const out = md();
    expect(out).toContain('| Environment | Tag | Notes |');
    expect(out).toContain('| --- | --- | --- |');
  });

  it('descends into a paragraph that hosts a block component', () => {
    // The whole defect in one assertion: the table lives inside a
    // `.scriptor-paragraph`, which used to be flattened by `buildParagraph`.
    const out = md();
    expect(out).toContain('Intro paragraph.');
    expect(out).toContain('Closing paragraph.');
    expect(out).toMatch(/^\| Environment/m);
  });

  it('drops the aria-hidden row-number gutter column', () => {
    const rows = md()
      .split('\n')
      .filter((line) => line.startsWith('|'));
    // Three content columns, not four: the gutter holding "1" and "2" is gone.
    for (const row of rows) {
      expect(row.split(/(?<!\\)\|/).length - 2).toBe(3);
    }
    expect(md()).not.toMatch(/^\| 1 \|/m);
  });

  it('ignores the aria-hidden column-grabber table', () => {
    // Only one header separator line: the mirror table must not become a
    // second, empty table.
    expect(md().match(/^\| --- /gm)).toHaveLength(1);
  });

  it('excludes the in-table "New" row button', () => {
    expect(md()).not.toMatch(/\bNew\b/);
  });

  it('merges a styled run that Loop split across sibling spans', () => {
    expect(md()).toContain('**Development**');
    expect(md()).not.toContain('**Dev****elop****ment**');
  });

  it('merges inline code that Loop fragmented, and does not fence it', () => {
    const out = md();
    expect(out).toContain('`dev-ready`');
    expect(out).not.toContain('```');
  });

  it('joins multiple paragraphs in a cell with <br>', () => {
    expect(md()).toContain('Scan is green.<br>Cert is verified.');
  });

  it('renders a list inside a cell as bullets on one line', () => {
    expect(md()).toContain('• Sign-off in QA<br>• Pipe \\| in a cell');
  });

  it('escapes a pipe inside cell content so the table stays valid', () => {
    expect(md()).toContain('\\|');
  });

  it('emits no stray hard break from the scriptor-EOP sentinel', () => {
    expect(md()).not.toMatch(/\\$/m);
  });
});

describe('Loop lists (real markup)', () => {
  const md = (): string => body(fixture('loop-list.html'));

  it('merges the flat run of single-item lists into one list', () => {
    // Loop emits one <ul> per item, which previously rendered as separate
    // lists with a blank line between every bullet.
    const out = md();
    expect(out).not.toMatch(/^- Pull secure image\n\n- Hardening/m);
    expect(out).toContain('- Pull secure image\n- Hardening and configuration\n');
  });

  it('nests by aria-level rather than DOM containment', () => {
    const out = md();
    expect(out).toMatch(/^ {2}1\. Install OS packages$/m);
    expect(out).toMatch(/^ {2}2\. Install certificate$/m);
    expect(out).toMatch(/^ {5}- Deepest note$/m);
  });

  it('detects a numbered list from its rendered marker, not an <ol>', () => {
    // There is not a single <ol> in the fixture, exactly as in real Loop.
    expect(fixture('loop-list.html').querySelector('ol')).toBeNull();
    expect(md()).toContain('1. Install OS packages');
  });

  it('keeps top-level bullets at the outer level', () => {
    expect(md()).toMatch(/^- Tag and push$/m);
  });
});
