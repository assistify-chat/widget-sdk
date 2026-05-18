# Releasing

How to ship a change to `@assistifychat/widget`.

## Make a change

1. Edit code in this repo.
2. Validate locally:
   ```
   pnpm install
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm exec publint
   node scripts/attw.mjs
   pnpm size
   ```
3. Add a changeset describing the change:
   ```
   pnpm changeset
   ```
   Pick a bump type (`patch`, `minor`, `major`) and write one terse line about what changed. The CLI drops a Markdown file in `.changeset/`. Commit that file along with your code.
4. Commit + push to `main`.

## Bump types

- `patch`: bugfix, internal refactor, no API surface change.
- `minor`: new feature, backward compatible.
- `major`: breaking change. Document the migration in `MIGRATING.md` in the same commit.

## What happens on push to `main`

1. CI runs typecheck, tests, build, publint, attw, size-limit.
2. The `release` workflow opens a "Version Packages" PR that bumps `package.json`, deletes the consumed changesets, and updates `CHANGELOG.md`.
3. Review + squash-merge the PR.
4. The workflow runs again on the merge commit. The `npm-publish` environment pauses for a reviewer click; approve from the Actions tab.
5. `npm publish --provenance --access public` runs via OIDC trusted publishing. The new version lands on the registry with a provenance attestation linked to this repo.

## Verify

```
npm view @assistifychat/widget version
```

Must match `package.json` after the publish run completes. The package page on npm shows a "Provenance" badge linking to the GitHub Actions run that built the tarball.

## Hotfix without a changeset

Don't. If the only change worth shipping is the version itself, write a `patch` changeset with a one-line note explaining the intent. Empty publishes are not auditable later.

## When the API contract changes

Mirror the change in the Assistify monorepo at `packages/shared-types/src/widget/public-api.types.ts` so the runtime emits exactly what the SDK declares. Land both repos in the same window.
