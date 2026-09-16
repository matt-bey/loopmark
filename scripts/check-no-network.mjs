#!/usr/bin/env node
/**
 * The load-bearing security check.
 *
 * loopmark runs arbitrary JavaScript inside an authenticated corporate SaaS
 * session. The one property that makes that defensible is that nothing it
 * reads can leave the browser. This script enforces that mechanically by
 * scanning the *built artifact* -- not the source -- so a future dependency,
 * build-step change, or careless edit fails CI rather than passing review.
 *
 * It also bans credential access, because a tool that reads cookies or
 * localStorage is a different and much less defensible kind of tool.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BANNED = [
  // --- network egress ---
  { pattern: /\bfetch\s*\(/, label: 'fetch(', why: 'network request' },
  { pattern: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest', why: 'network request' },
  { pattern: /\bWebSocket\b/, label: 'WebSocket', why: 'network request' },
  { pattern: /\bsendBeacon\b/, label: 'sendBeacon', why: 'network request' },
  { pattern: /\bEventSource\b/, label: 'EventSource', why: 'network request' },
  { pattern: /\bnavigator\s*\.\s*sendBeacon\b/, label: 'navigator.sendBeacon', why: 'network request' },
  { pattern: /\bimport\s*\(/, label: 'import(', why: 'could load remote code' },
  { pattern: /\bimportScripts\b/, label: 'importScripts', why: 'could load remote code' },
  { pattern: /\bnew\s+Worker\b/, label: 'new Worker', why: 'could load remote code' },
  { pattern: /\bnew\s+SharedWorker\b/, label: 'new SharedWorker', why: 'could load remote code' },
  { pattern: /\bserviceWorker\b/, label: 'serviceWorker', why: 'could load remote code' },

  // --- credential and storage access ---
  { pattern: /\bdocument\s*\.\s*cookie\b/, label: 'document.cookie', why: 'credential access' },
  { pattern: /\blocalStorage\b/, label: 'localStorage', why: 'credential access' },
  { pattern: /\bsessionStorage\b/, label: 'sessionStorage', why: 'credential access' },
  { pattern: /\bindexedDB\b/, label: 'indexedDB', why: 'credential access' },
  { pattern: /\bcredentials\s*:/, label: 'credentials:', why: 'credential access' },

  // --- mutating the Loop document ---
  { pattern: /\bform\s*\.\s*submit\s*\(/, label: 'form.submit(', why: 'mutating action' },
];

const TARGETS = [
  { name: 'dist/loopmark.bundle.js', decode: false },
  { name: 'dist/loopmark.bookmarklet.txt', decode: true },
];

let failed = false;

for (const target of TARGETS) {
  let source;
  try {
    source = readFileSync(resolve(ROOT, target.name), 'utf8');
  } catch {
    console.error(`FAIL  ${target.name} is missing. Run \`npm run build\` first.`);
    failed = true;
    continue;
  }

  if (target.decode) {
    if (!source.startsWith('javascript:')) {
      console.error(`FAIL  ${target.name} does not start with "javascript:".`);
      failed = true;
      continue;
    }
    source = decodeURIComponent(source.slice('javascript:'.length));
  }

  const hits = [];
  for (const { pattern, label, why } of BANNED) {
    const match = pattern.exec(source);
    if (!match) continue;
    const start = Math.max(0, match.index - 60);
    const context = source.slice(start, match.index + 60).replace(/\s+/g, ' ');
    hits.push({ label, why, context });
  }

  if (hits.length === 0) {
    console.log(`ok    ${target.name} — no network egress, no credential access`);
    continue;
  }

  failed = true;
  console.error(`FAIL  ${target.name}`);
  for (const hit of hits) {
    console.error(`        ${hit.label}  (${hit.why})`);
    console.error(`        ...${hit.context}...`);
  }
}

if (failed) {
  console.error(
    '\nloopmark must make zero network requests and must never touch credentials.\n' +
      'This check existing, and being visible in CI, is the argument handed to a\n' +
      'security reviewer. See SECURITY.md. Do not add exceptions.',
  );
  process.exit(1);
}
