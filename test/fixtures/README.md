# Test fixtures

Every file here is **synthetic**. Nothing in this directory came from a real
Microsoft Loop page.

Rules, enforced by `scripts/check-fixtures.mjs` in CI:

- No real company domains, tenant IDs, or GUIDs.
- No real people's names — use `Person A`, `Reviewer B`.
- No internal project, service, or system names.
- URLs use the reserved `example.invalid` / `example.com` domains only.

If you are adding a fixture after debugging a real page, retype it by hand
from the *shape* of the markup. Do not paste and redact.
