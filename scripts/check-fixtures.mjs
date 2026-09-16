#!/usr/bin/env node
/**
 * Fixture scrub check.
 *
 * This is a public repository and the fixtures describe the shape of internal
 * documents. Anything that could identify a tenant, a person, or an internal
 * system must never land here. Fixtures are written by hand from the *shape*
 * of real markup, never pasted and redacted.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = resolve(ROOT, 'test/fixtures');

const BANNED = [
  { pattern: /\bacmecorp\b/i, label: 'company domain (acmecorp)' },
  { pattern: /\bacme-brands\b/i, label: 'company domain (acme-brands)' },
  { pattern: /\.sharepoint\.com/i, label: 'SharePoint tenant URL' },
  { pattern: /\bloop\.cloud\.microsoft\b/i, label: 'real Loop URL' },
  { pattern: /\bdev\.azure\.com\b/i, label: 'internal Azure DevOps URL' },
  { pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, label: 'GUID (tenant or item id)' },
  { pattern: /[\w.+-]+@(?!example\.(?:com|invalid|org))[\w-]+\.[\w.-]+/, label: 'email address' },
];

/** Only reserved example domains are allowed in fixture URLs. */
const ALLOWED_HOSTS = /^(?:[\w-]+\.)*example\.(?:com|invalid|org|net)$/i;

let failed = false;

for (const name of readdirSync(FIXTURES).sort()) {
  if (!['.html', '.htm'].includes(extname(name))) continue;
  const text = readFileSync(resolve(FIXTURES, name), 'utf8');
  const problems = [];

  for (const { pattern, label } of BANNED) {
    const match = pattern.exec(text);
    if (match) problems.push(`${label}: "${match[0]}"`);
  }

  for (const match of text.matchAll(/https?:\/\/([^/\s"'<>)]+)/gi)) {
    const host = (match[1] ?? '').replace(/:\d+$/, '');
    if (!ALLOWED_HOSTS.test(host)) {
      problems.push(`non-example host: "${host}" (use example.invalid)`);
    }
  }

  if (problems.length === 0) {
    console.log(`ok    test/fixtures/${name}`);
    continue;
  }
  failed = true;
  console.error(`FAIL  test/fixtures/${name}`);
  for (const problem of problems) console.error(`        ${problem}`);
}

if (failed) {
  console.error(
    '\nFixtures must be synthetic. Retype the markup by hand from its shape;\n' +
      'do not paste real page content and redact it. See test/fixtures/README.md.',
  );
  process.exit(1);
}
