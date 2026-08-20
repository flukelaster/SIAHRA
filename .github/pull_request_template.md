<!--
SIAHRA PR conventions:
- `main` only accepts PRs where Lint / TypeScript / Build are green (see .github/rulesets/main.json)
- Title, description AND commit messages are ENGLISH ONLY. Code comments may stay Thai.
- UI change (apps/web/src/{components,scene}, App.tsx, index.css, public/*) → embed a screenshot
  below. Drag a PNG in, or from the CLI:
      scripts/pr-media.sh "$(git branch --show-current)" shot.png
  and paste the Markdown it prints. Nothing visibly changed → add the `no-screenshot` label.
- The screenshot and language rules are no longer enforced by a CI job (they used to burn Actions
  minutes). `/implement` self-checks both before opening a PR — if you open one by hand, check them
  yourself.
-->

## What / Why


## Screenshot (required when UI changed)


## Checklist
- [ ] `npx tsc -b` (apps/web), `npx tsc --noEmit` (apps/api, apps/etl), `npx oxlint src worker` (apps/web) pass locally
- [ ] Ran through `/implement` (QA verdict green, docs synced) — or explain why not
- [ ] New/changed hazard layers declare the right `HazardLayerDescriptor` kind (observed / static-reference / illustrative / probabilistic) and the UI shows `fetchedAt`/`observedAt`
- [ ] No self-invented forecast numbers; stale data and dead sources stay visible instead of disappearing
- [ ] If `packages/shared-types` changed → every api/web/etl consumer of that contract was updated
- [ ] Title, description and commit messages are in English
