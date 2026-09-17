#!/usr/bin/env node
/**
 * Scrub check.
 *
 * This is a public repository built by reading private documents, so anything
 * that could identify a tenant, a person, or an internal system must never
 * land in it. Fixtures are written by hand from the *shape* of real markup,
 * never pasted and redacted.
 *
 * Scans every committed text file, not just fixtures: the first leak in this
 * repository was not in a fixture at all, it was an employer's internal
 * project name quoted as an example in a source comment and in a commit
 * message, where a fixtures-only gate could never see it.
 *
 * The patterns below are deliberately generic. Naming your own employer in a
 * public scrubber tells everyone who reads it where the code came from, which
 * is the thing the scrubber exists to prevent. Put private terms in
 * `scrub.local.json` instead -- it is gitignored, and the check reads it when
 * present:
 *
 *   { "banned": ["acme-corp", "internal-project-name"] }
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Everything git tracks, minus binaries and the lockfile. */
function trackedTextFiles() {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return listed
    .split('\0')
    .filter(Boolean)
    .filter((f) => !/^(dist|node_modules)\//.test(f))
    .filter((f) => f !== 'package-lock.json')
    .filter((f) => !/\.(png|jpe?g|gif|ico|woff2?|zip)$/i.test(f));
}

/** Private terms, kept out of the repository. See the header comment. */
function localBanned() {
  try {
    const raw = readFileSync(resolve(ROOT, 'scrub.local.json'), 'utf8');
    const list = JSON.parse(raw).banned ?? [];
    return list.map((term) => ({
      pattern: new RegExp(`\\b${String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
      label: 'locally banned term',
    }));
  } catch {
    return [];
  }
}

/** Applies to every tracked file. */
const BANNED = [
  { pattern: /\.sharepoint\.com/i, label: 'SharePoint tenant URL' },
  { pattern: /\bdev\.azure\.com\b/i, label: 'internal Azure DevOps URL' },
  { pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, label: 'GUID (tenant or item id)' },
  {
    // `anthropic.com` is exempt: commit trailers carry a no-reply attribution
    // address, which identifies nobody.
    pattern: /[\w.+-]+@(?!example\.(?:com|invalid|org|net)|anthropic\.com)[\w-]+\.[\w.-]+/,
    label: 'email address',
  },
  ...localBanned(),
];

/**
 * Fixtures only. `loop.cloud.microsoft` is the host loopmark targets, so it
 * belongs in the selectors, the README and the plan -- but a *fixture* naming
 * it means real page content was pasted rather than retyped.
 */
const FIXTURE_BANNED = [{ pattern: /\bloop\.cloud\.microsoft\b/i, label: 'real Loop URL' }];

/** Only reserved example domains are allowed in fixture URLs. */
/**
 * Hosts a fixture may name. `example.*` is the reserved documentation space;
 * `w3.org` is allowed because XML namespace URIs are part of the markup being
 * reproduced (MathML declares `xmlns="http://www.w3.org/1998/Math/MathML"`)
 * and a standards URL can never be the internal or customer data this gate
 * exists to catch.
 */
const ALLOWED_HOSTS = /^(?:[\w-]+\.)*(?:example\.(?:com|invalid|org|net)|w3\.org)$/i;

let failed = false;

/** The check's own source names the patterns it bans; it cannot flag itself. */
const SELF = 'scripts/check-fixtures.mjs';

for (const file of trackedTextFiles()) {
  if (file === SELF) continue;
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  const problems = [];

  for (const { pattern, label } of BANNED) {
    const match = pattern.exec(text);
    if (match) problems.push(`${label}: "${match[0]}"`);
  }

  // Fixtures additionally may only name reserved example hosts. Prose
  // elsewhere legitimately links to real documentation.
  if (file.startsWith('test/fixtures/')) {
    for (const { pattern, label } of FIXTURE_BANNED) {
      const match = pattern.exec(text);
      if (match) problems.push(`${label}: "${match[0]}"`);
    }
    for (const match of text.matchAll(/https?:\/\/([^/\s"'<>)]+)/gi)) {
      const host = (match[1] ?? '').replace(/:\d+$/, '');
      if (!ALLOWED_HOSTS.test(host)) {
        problems.push(`non-example host: "${host}" (use example.invalid)`);
      }
    }
  }

  if (problems.length > 0) {
    failed = true;
    console.error(`FAIL  ${file}`);
    for (const problem of problems) console.error(`        ${problem}`);
  }
}

// Commit messages are published too, and no file-based check can see them.
const messages = execFileSync('git', ['log', '--format=%H%x00%B%x00'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
for (const entry of messages.split('\0\n').filter(Boolean)) {
  const [sha, body = ''] = entry.split('\0');
  for (const { pattern, label } of BANNED) {
    const match = pattern.exec(body);
    if (match) {
      failed = true;
      console.error(`FAIL  commit ${sha?.slice(0, 8)} message`);
      console.error(`        ${label}: "${match[0]}"`);
    }
  }
}

if (!failed) console.log('ok    no banned terms in tracked files or commit messages');

if (failed) {
  console.error(
    '\nFixtures must be synthetic: retype the markup by hand from its shape,\n' +
      'do not paste real page content and redact it. See test/fixtures/README.md.\n' +
      'A flagged commit message needs a history rewrite, not just a new commit.',
  );
  process.exit(1);
}
