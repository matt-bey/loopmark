import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_TAG,
  removeExistingOverlay,
  showMessage,
  showOverlay,
  truncationWarning,
} from '../src/ui.js';
import type { Diagnostics } from '../src/types.js';

const diagnostics = (over: Partial<Diagnostics> = {}): Diagnostics => ({
  contentRootStrategy: 'main-contenteditable',
  shadowRootsPierced: 4,
  unrecognizedElements: 0,
  unrecognizedSamples: [],
  droppedDataImages: 0,
  expandedWidgets: 2,
  elementsVisited: 120,
  warnings: [],
  ...over,
});

const overlay = (): Element | null => document.querySelector(OVERLAY_TAG);
const shadow = (): ShadowRoot => overlay()!.shadowRoot!;
const buttonLabelled = (text: string): HTMLButtonElement =>
  Array.from(shadow().querySelectorAll('button')).find((b) => b.textContent === text)!;

beforeEach(() => {
  document.body.innerHTML = '';
  // jsdom implements neither of the copy paths; stub them per-test as needed.
  document.execCommand = vi.fn(() => true) as unknown as typeof document.execCommand;
});

describe('truncationWarning', () => {
  it('stays quiet on small pages', () => {
    expect(truncationWarning('short', diagnostics({ elementsVisited: 40 }))).toBeNull();
  });

  it('stays quiet when output is proportionate to the walk', () => {
    expect(truncationWarning('x'.repeat(5000), diagnostics({ elementsVisited: 900 }))).toBeNull();
  });

  it('warns when a big walk produced little text', () => {
    const warning = truncationWarning('tiny', diagnostics({ elementsVisited: 4000 }));
    expect(warning).toContain('4,000');
    expect(warning).toContain('may be incomplete');
  });
});

describe('showOverlay', () => {
  it('mounts inside its own shadow root and does not leak into the page', () => {
    showOverlay({ markdown: '# Hi', title: 'T', diagnostics: diagnostics(), autoCopy: 'clipboard-api' });

    expect(overlay()).not.toBeNull();
    expect(shadow().mode).toBe('open');
    // Nothing but the single custom element is added to the page.
    expect(document.body.children.length).toBe(1);
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('puts the markdown in a read-only, pre-selected textarea', () => {
    const markdown = '# Title\n\n- one\n- two';
    showOverlay({ markdown, title: 'T', diagnostics: diagnostics(), autoCopy: 'clipboard-api' });

    const textarea = shadow().querySelector('textarea')!;
    expect(textarea.value).toBe(markdown);
    expect(textarea.hasAttribute('readonly')).toBe(true);
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(markdown.length);
  });

  it('reports the auto-copy outcome honestly', () => {
    showOverlay({ markdown: 'x', title: 'T', diagnostics: diagnostics(), autoCopy: 'clipboard-api' });
    expect(shadow().querySelector('.status')!.textContent).toBe('Copied to clipboard');
    removeExistingOverlay();

    showOverlay({ markdown: 'x', title: 'T', diagnostics: diagnostics(), autoCopy: 'failed' });
    expect(shadow().querySelector('.status')!.textContent).toContain('Ctrl/Cmd+C');
    expect(shadow().querySelector('.status')!.className).toContain('warn');
  });

  it('shows line and character counts', () => {
    showOverlay({ markdown: 'a\nb\nc', title: 'T', diagnostics: diagnostics(), autoCopy: 'failed' });
    expect(shadow().querySelector('.sub')!.textContent).toBe('3 lines · 5 characters');
  });

  it('surfaces diagnostics behind a Details disclosure', () => {
    showOverlay({
      markdown: 'x',
      title: 'T',
      autoCopy: 'clipboard-api',
      diagnostics: diagnostics({ unrecognizedSamples: ['x-widget'], unrecognizedElements: 3 }),
    });
    const pre = shadow().querySelector('details pre')!.textContent!;
    expect(pre).toContain('main-contenteditable');
    expect(pre).toContain('shadow roots pierced  : 4');
    expect(pre).toContain('x-widget');
  });

  it('shows warnings, including the truncation detector', () => {
    showOverlay({
      markdown: 'tiny',
      title: 'T',
      autoCopy: 'clipboard-api',
      diagnostics: diagnostics({ elementsVisited: 5000, warnings: ['Custom warning'] }),
    });
    const text = shadow().querySelector('.warnings')!.textContent!;
    expect(text).toContain('Custom warning');
    expect(text).toContain('may be incomplete');
  });

  it('closes on Escape', () => {
    showOverlay({ markdown: 'x', title: 'T', diagnostics: diagnostics(), autoCopy: 'failed' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay()).toBeNull();
  });

  it('closes on the X button and on the Close button', () => {
    showOverlay({ markdown: 'x', title: 'T', diagnostics: diagnostics(), autoCopy: 'failed' });
    (shadow().querySelector('.close-x') as HTMLButtonElement).click();
    expect(overlay()).toBeNull();

    showOverlay({ markdown: 'x', title: 'T', diagnostics: diagnostics(), autoCopy: 'failed' });
    buttonLabelled('Close').click();
    expect(overlay()).toBeNull();
  });

  it('closes when the backdrop itself is clicked, but not the panel', () => {
    showOverlay({ markdown: 'x', title: 'T', diagnostics: diagnostics(), autoCopy: 'failed' });
    const backdrop = shadow().querySelector('.backdrop')!;

    shadow().querySelector('.panel')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(overlay()).not.toBeNull();

    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(overlay()).toBeNull();
  });

  it('stops listening for Escape after closing', () => {
    showOverlay({ markdown: 'x', title: 'T', diagnostics: diagnostics(), autoCopy: 'failed' });
    buttonLabelled('Close').click();
    // Must not throw against a detached overlay.
    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ).not.toThrow();
  });

  it('replaces a previous overlay rather than stacking', () => {
    showOverlay({ markdown: 'first', title: 'T', diagnostics: diagnostics(), autoCopy: 'failed' });
    showOverlay({ markdown: 'second', title: 'T', diagnostics: diagnostics(), autoCopy: 'failed' });
    expect(document.querySelectorAll(OVERLAY_TAG).length).toBe(1);
    expect(shadow().querySelector('textarea')!.value).toBe('second');
  });

  it('copies via the Copy button using the execCommand fallback', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('no activation'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    showOverlay({ markdown: 'payload', title: 'T', diagnostics: diagnostics(), autoCopy: 'failed' });
    buttonLabelled('Copy Markdown').click();
    await vi.waitFor(() => expect(document.execCommand).toHaveBeenCalledWith('copy'));
    expect(writeText).toHaveBeenCalledWith('payload');
  });
});

describe('showMessage', () => {
  it('renders the host-guard message with an escape-hatch action', () => {
    const onClick = vi.fn();
    showMessage({
      heading: 'Not a Loop page',
      message: 'You are somewhere else.',
      action: { label: 'Export anyway', onClick },
    });

    expect(shadow().querySelector('h1')!.textContent).toBe('Not a Loop page');
    buttonLabelled('Export anyway').click();
    expect(onClick).toHaveBeenCalledOnce();
    // The action closes the message before running.
    expect(overlay()).toBeNull();
  });

  it('omits the Close button while busy', () => {
    showMessage({ heading: 'loopmark', message: 'Reading…', busy: true });
    const labels = Array.from(shadow().querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).not.toContain('Close');
  });

  it('shows an error detail behind a disclosure', () => {
    showMessage({ heading: 'Error', message: 'It broke.', detail: 'TypeError: nope' });
    expect(shadow().querySelector('details pre')!.textContent).toContain('TypeError: nope');
  });
});
