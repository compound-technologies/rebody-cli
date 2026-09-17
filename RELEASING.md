# Release process

npm publication requires the owner's explicit approval for the version. The
matching backend code must have landed and passed its deployment checks.
There is no workflow that publishes a package in this repository.

Before publication:

1. Run the tests on all supported CI platforms and inspect the release diff.
2. Run Gitleaks against the complete Git history and a clean export of the tree.
3. Run `npm audit --omit=dev` and inspect `npm pack --dry-run --json`. Only bin,
   lib, README, LICENSE and package metadata belong in the npm artifact.
4. Install the tarball in an empty directory and check the command. Confirm the
   intended backend supports the version before enabling hosted imports.
5. Confirm npm organization membership and MFA. After the first package exists,
   configure npm trusted publishing for this public repository and a release
   environment that requires owner approval. Verify provenance for each release.
6. Obtain owner approval before running a publish command. Keep the package
   version, README examples, agent instructions and backend rollout in sync.

Never add an npm token to this repository. Do not enable automatic publishing
on push, pull requests or tags. A source release and a registry release are
separate actions; permission for one does not authorize the other.
