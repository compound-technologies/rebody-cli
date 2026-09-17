# Contributing

Use Node.js 22 or newer. Install with `npm ci --ignore-scripts`, then run
`npm test`, `node bin/rebody.mjs --help`, and `npm pack --dry-run`.

Open a pull request with the change and its test results. Use synthetic fixtures
and mocked requests. Do not include real health records, filenames from patient
records, tokens, signed URLs, environment files, or screenshots of accounts.

Preserve origin checks, credential-store handling, redirect rejection and the
upload permission boundary. Pin dependency versions and update the lockfile.
CI runs tests on Linux, macOS and Windows and scans Git history for secrets.

Report security issues privately as described in SECURITY.md.
