# Rebody CLI

Upload original DNA files and bloodwork to your [Rebody](https://rebodyhealth.com)
account from a terminal or local agent. Requires Node.js 22 or newer.

**Pre-release:** The npm package is not published. Hosted agent imports remain
disabled until release approval. You can inspect the source and run tests now.

## Run from source

```sh
git clone https://github.com/compound-technologies/rebody-cli.git
cd rebody-cli
npm ci --ignore-scripts
npm test
node bin/rebody.mjs --help
```

## Upload workflow

Once hosted imports are enabled, start a connection:

```sh
node bin/rebody.mjs auth login --json
```

Open the returned link yourself, check the code, and approve the connection.
Your agent can then run:

```sh
node bin/rebody.mjs auth wait --json
node bin/rebody.mjs records upload "/path/to/labs.pdf" --kind bloodwork --json
node bin/rebody.mjs records upload "/path/to/dna.zip" --kind dna --json
```

The planned npm command is `npx --yes @rebodyhealth/cli@0.1.0` followed by the
same arguments. It will work after the package is published.

`auth wait` returns exit code 2 while approval is pending. Repeat after approval.
Commands return JSON; errors exit with code 1. Uploads up to 5 GiB are supported.
Retry the same command to reuse its record. Use `--new-upload` only when you
intend to create a separate record.

Check access with `auth status`. Run `auth logout` to revoke the connection and
remove the saved credential. Log out before connecting to a different account.
Connections expire after 30 days and can also be revoked from your Rebody account.

## Data and permissions

- You choose the file path. The CLI does not search your computer or log in to
  a health provider on its own. A local agent may help you locate files.
- Credentials are saved in the operating system credential store. There is no
  plaintext fallback. Unlock your credential store if a command cannot use it.
- The CLI sends file metadata to Rebody and streams file bytes to private
  storage. It does not forward the Rebody bearer token to storage or follow
  redirects on authenticated requests.
- Access is limited to uploads and their status. It cannot read existing records,
  send messages, place orders, or share files with a clinician. DNA imports save
  the original file without ordering analysis.
- Issued upload links can remain valid for up to two hours after revocation.
  A revoked connection cannot complete an import through the API.
- Each new upload link reserves up to 5 GiB of capacity. The shared hourly
  budget permits at most four links when unused. Incomplete retries can use
  another link; completed retries use none.

Read the [agent guide](https://rebodyhealth.com/agent-import/guide.md) for file
selection and the API contract. No MCP installation or agent restart is needed.

## Development and releases

Tests use synthetic bytes and mocked network calls. They need no Rebody login,
patient files, API keys, or operating system credential-store access.

For a compatible local development API, pass `--origin http://localhost:3000`.
Credentials are isolated by origin. The CLI does not include the hosted backend.
`REBODY_TOKEN` can supply a credential from a secret manager for advanced use;
never paste a token into an issue or chat.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[RELEASING.md](RELEASING.md). This repository is the source for future CLI releases.

## License

[MIT](LICENSE).
