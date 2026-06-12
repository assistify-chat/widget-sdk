# Changesets

Each user-visible change should land with a changeset. Run `pnpm changeset` to create one. The release workflow opens a "Version Packages" PR that consumes pending changesets and bumps `package.json` + `CHANGELOG.md`. Merging that PR triggers the publish.

Skip the changeset for internal-only changes (CI config, dev tooling, README typos). The release workflow no-ops when there are no pending changesets.
