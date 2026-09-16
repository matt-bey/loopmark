/**
 * The output overlay.
 *
 * Mounted inside its own open shadow root so that Loop's stylesheets cannot
 * reach in and ours cannot leak out. The only DOM mutation loopmark makes to
 * the host page is appending (and later removing) a single custom element.
 */

import type { Diagnostics } from './types.js';

export const OVERLAY_TAG = 'loopmark-overlay';

const STYLE = `
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

export interface OverlayOptions {
  markdown: string;
  title: string;
  diagnostics: Diagnostics;
  /** Outcome of the automatic copy attempt made before the overlay opened. */
  autoCopy: CopyOutcome;
}

export type CopyOutcome = 'clipboard-api' | 'exec-command' | 'failed';

/** Remove any overlay left behind by a previous run. */
export function removeExistingOverlay(): void {
  for (const node of Array.from(document.querySelectorAll(OVERLAY_TAG))) node.remove();
}

/**
 * Copy `text`, trying progressively older mechanisms.
 *
 * The async Clipboard API needs transient user activation, which may already
 * have expired after `forceRender` scrolled for several seconds. `execCommand`
 * on a live selection is the fallback, and a caller-visible 'failed' is the
 * honest third outcome -- the overlay then tells the user to press Ctrl/Cmd+C.
 */
export async function copyText(text: string, selectable?: HTMLTextAreaElement): Promise<CopyOutcome> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'clipboard-api';
    }
  } catch {
    // Fall through to the legacy path.
  }

  const area = selectable ?? (() => {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('aria-hidden', 'true');
    scratch.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(scratch);
    return scratch;
  })();

  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    return ok ? 'exec-command' : 'failed';
  } catch {
    return 'failed';
  } finally {
    if (!selectable) area.remove();
  }
}

/** Save `text` as a `.md` file. Blob + object URL is entirely local. */
function download(text: string, title: string): void {
  const safe = (title || 'loop-page')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'loop-page';
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}.md`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next turn so the download has picked the blob up first.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

/**
 * Cheap truncation detector.
 *
 * If we walked thousands of elements but produced very little text, something
 * swallowed the content -- most likely a selector change or a closed shadow
 * root. Better to say so than to let the user paste a near-empty file.
 */
export function truncationWarning(markdown: string, diagnostics: Diagnostics): string | null {
  const { elementsVisited } = diagnostics;
  if (elementsVisited < 200) return null;
  if (markdown.length >= elementsVisited) return null;
  return (
    `Walked ${elementsVisited.toLocaleString()} elements but produced only ` +
    `${markdown.length.toLocaleString()} characters. The output may be incomplete — ` +
    `see Details, and check src/selectors.ts.`
  );
}

export function showOverlay(options: OverlayOptions): void {
  const { markdown, title, diagnostics, autoCopy } = options;
  removeExistingOverlay();

  const host = document.createElement(OVERLAY_TAG);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(el('style', { textContent: STYLE }));

  const lines = markdown.split('\n').length;
  const statusText: Record<CopyOutcome, string> = {
    'clipboard-api': 'Copied to clipboard',
    'exec-command': 'Copied to clipboard',
    failed: 'Not copied — press Copy, or Ctrl/Cmd+C',
  };
  const status = el('span', {
    className: `status ${autoCopy === 'failed' ? 'warn' : 'ok'}`,
    textContent: statusText[autoCopy],
  });

  const textarea = el('textarea', { value: markdown, spellcheck: false });
  textarea.setAttribute('readonly', 'readonly');
  textarea.setAttribute('aria-label', 'Exported Markdown');

  const closeButton = el('button', { className: 'close-x', textContent: '✕', title: 'Close (Esc)' });
  closeButton.setAttribute('aria-label', 'Close');

  const header = el('header', {}, [
    el('h1', { textContent: 'loopmark' }),
    el('span', {
      className: 'sub',
      textContent: `${lines.toLocaleString()} lines · ${markdown.length.toLocaleString()} characters`,
    }),
    el('div', { className: 'spacer' }),
    status,
    closeButton,
  ]);

  const warnings = [...diagnostics.warnings];
  const truncation = truncationWarning(markdown, diagnostics);
  if (truncation) warnings.push(truncation);

  const copyButton = el('button', { className: 'primary', textContent: 'Copy Markdown' });
  const downloadButton = el('button', { textContent: 'Download .md' });
  const closeFooter = el('button', { textContent: 'Close' });

  const details = el('details', {}, [
    el('summary', { textContent: 'Details' }),
    el('pre', {
      textContent: [
        `content root strategy : ${diagnostics.contentRootStrategy}`,
        `elements visited      : ${diagnostics.elementsVisited}`,
        `shadow roots pierced  : ${diagnostics.shadowRootsPierced}`,
        `disclosures expanded  : ${diagnostics.expandedWidgets}`,
        `unrecognized elements : ${diagnostics.unrecognizedElements}`,
        `unrecognized tags     : ${diagnostics.unrecognizedSamples.join(', ') || '(none)'}`,
      ].join('\n'),
    }),
  ]);

  const panel = el('div', { className: 'panel' }, [header]);
  if (warnings.length > 0) {
    panel.append(
      el('div', { className: 'warnings' }, [
        el('strong', { textContent: 'Heads up' }),
        el('ul', {}, warnings.map((w) => el('li', { textContent: w }))),
      ]),
    );
  }
  panel.append(
    textarea,
    el('footer', {}, [
      copyButton,
      downloadButton,
      el('div', { className: 'spacer' }),
      details,
      closeFooter,
    ]),
  );

  const backdrop = el('div', { className: 'backdrop' }, [panel]);
  shadow.append(backdrop);

  // --- behaviour -----------------------------------------------------------

  const close = (): void => {
    document.removeEventListener('keydown', onKeydown, true);
    host.remove();
  };

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  // Capture phase, because Loop's editor also listens for Escape and would
  // otherwise consume it before the overlay sees it.
  document.addEventListener('keydown', onKeydown, true);
  shadow.addEventListener('keydown', onKeydown as EventListener, true);

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  closeButton.addEventListener('click', close);
  closeFooter.addEventListener('click', close);

  copyButton.addEventListener('click', () => {
    void copyText(markdown, textarea).then((outcome) => {
      copyButton.textContent = outcome === 'failed' ? 'Press Ctrl/Cmd+C' : 'Copied';
      status.className = `status ${outcome === 'failed' ? 'warn' : 'ok'}`;
      status.textContent = statusText[outcome];
      if (outcome === 'failed') {
        textarea.focus({ preventScroll: true });
        textarea.select();
      }
      setTimeout(() => {
        copyButton.textContent = 'Copy Markdown';
      }, 2000);
    });
  });

  downloadButton.addEventListener('click', () => download(markdown, title));

  document.body.appendChild(host);

  // Pre-select so Ctrl/Cmd+C works immediately even if both copy paths failed.
  textarea.focus({ preventScroll: true });
  textarea.select();
}

export interface MessageOptions {
  heading: string;
  message: string;
  /** Extra text shown behind a "Details" disclosure. */
  detail?: string;
  /** An optional escape hatch, e.g. "Export anyway" on an unrecognized host. */
  action?: { label: string; onClick: () => void };
  /** Suppress the Close button for transient progress messages. */
  busy?: boolean;
}

/** Minimal overlay for the host-guard, progress and error cases. */
export function showMessage({ heading, message, detail, action, busy }: MessageOptions): void {
  removeExistingOverlay();
  const host = document.createElement(OVERLAY_TAG);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(el('style', { textContent: STYLE }));

  const closeButton = el('button', { className: 'primary', textContent: 'Close' });
  const panel = el('div', { className: 'panel' }, [
    el('header', {}, [el('h1', { textContent: heading })]),
    el('p', { className: 'msg', textContent: message }),
  ]);
  if (detail) {
    panel.append(el('details', {}, [
      el('summary', { textContent: 'Details' }),
      el('pre', { textContent: detail }),
    ]));
  }
  const footerNodes: HTMLElement[] = [el('div', { className: 'spacer' })];
  if (action) {
    const actionButton = el('button', { textContent: action.label });
    actionButton.addEventListener('click', () => {
      close();
      action.onClick();
    });
    footerNodes.push(actionButton);
  }
  if (!busy) footerNodes.push(closeButton);
  panel.append(el('footer', {}, footerNodes));

  const backdrop = el('div', { className: 'backdrop' }, [panel]);
  shadow.append(backdrop);

  const close = (): void => {
    document.removeEventListener('keydown', onKeydown, true);
    host.remove();
  };
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }
  document.addEventListener('keydown', onKeydown, true);
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });

  document.body.appendChild(host);
  if (!busy) closeButton.focus({ preventScroll: true });
}
