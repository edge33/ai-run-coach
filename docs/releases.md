# Releases

Release Please versions the root package as one application. A stable tag builds the combined
runtime image and pushes it to `ghcr.io/edge33/ai-run-coach`. There is no npm publishing or
automatic deployment. The first registry publication is still pending.

## Set up GitHub once

Add a repository Actions secret named `RELEASE_PLEASE_TOKEN`: a fine-grained token restricted
to this repository with Contents, Issues and Pull requests read/write permissions. Repository
policy must allow automated PR creation. Keep this token out of application `.env` files.

The custom token lets Release Please's PRs trigger CI and its tags trigger image publishing.
GitHub's default token suppresses those follow-up workflow runs. A missing secret makes the
release workflow fail with a setup message.

GHCR login uses the publishing job's `GITHUB_TOKEN` with `packages: write`; no registry password
is needed. If a package already exists, grant this repository Actions write access to it.
Make the package public for anonymous pulls; private consumers need GHCR credentials.

## Make a release

1. Merge Conventional Commits into `main`; use `feat:` or `fix:` for releasable changes.
2. Release Please opens or updates a PR with the root version, changelog and release manifest.
3. Review the CI results and merge that PR. Release Please creates a GitHub release and `vX.Y.Z` tag.
4. The tag workflow validates the version and main-branch ancestry, then builds and pushes the image.

For `v0.2.0`, image tags are `v0.2.0`, `0.2.0`, and `latest`. Use a version or digest for repeatable
deployments. `latest` means the last successfully published image, not the highest SemVer.
Builds currently target `linux/amd64`; prereleases and ARM builds are not configured.

The manifest starts at the existing root version `0.1.0`. The bootstrap SHA in
`release-please-config.json` limits the first changelog to work after the single-image merge.
Workspace packages are not released independently. Regular feature merges update the release PR;
only a release tag publishes an image.

## Manual tags and retries

A manually pushed `vMAJOR.MINOR.PATCH` tag also publishes, provided its commit is in `main` history
and contains the workflow. Malformed tags, prereleases and unmerged commits are rejected before
registry login. A manual tag does not update the version/changelog/manifest or create a GitHub release.
Prefer the managed flow, avoid moving tags, and remember that backfilling an older tag changes `latest`.

Retry failed image jobs from GitHub Actions. To retry release bookkeeping, manually dispatch
`Release Please` on `main`; it can create PRs/releases. Publishing never deploys or imports data.
See [deployment](storage.md) to use a published image.

References: [Release Please](https://github.com/googleapis/release-please-action) and
[GitHub container publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).
