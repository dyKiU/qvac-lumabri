# Repository Guidelines

## Scope and Change Discipline

- Only change files required for the task at hand.
- Do not include unrelated formatter, linter, dependency-install, or user changes.
- Preserve the existing async control-flow style unless the required behavior depends on changing it.
- Do not remove or refactor adjacent code without an explicit reason in scope.

## Git Commits

- Check `git status` before committing.
- Stage specific paths; do not use `git add .` or `git add -A`.
- Do not add AI-generated co-author trailers.

## Safe Deletion

- Avoid `rm -rf` for routine cleanup.
- Remove only explicit, narrowly scoped paths.
- Prefer `perl -MFile::Path=remove_tree -e 'remove_tree(q{PATH})'` for directory cleanup.

## Code Quality and Verification

- Prefer small, intent-revealing functions and focused comments for non-obvious decisions.
- Add or update focused tests for behavior changes.
- Run the relevant JavaScript and native checks before committing.
- Run `npm run check:hygiene` before publishing.

## Lumabri gateway patch rebases

When Lumabri `main` moves and `native/lumabri-gateway-main.patch` fails to apply:

- Follow [docs/lumabri-gateway-patch.md](docs/lumabri-gateway-patch.md).
- Update `dev-next` Lumabri and Colibri `sourceRef` values to current `main`.
  Release tags may sit behind `main`. Run `npm run docs:contracts`,
  `check:native-upstreams`, and `check:freshness`.
- Keep supported-line `native/lumabri-gateway.patch` unchanged unless promoting
  pins for a release.
- Pin-only drift is refreshed by `.github/workflows/upstream-pin-refresh.yml`.
  Autofix launches only when a Lumabri or QVAC canary job fails.

## Gateway patch behaviour policy

Applies to autofix agents and humans using the automation. The gateway patch's
behaviour is a product decision, not a compatibility detail.

- `native/lumabri-gateway-main.patch` may only be **rebased** onto new upstream
 code: context lines, line offsets, and hunk headers may move.
- Never add, remove, reorder, or change the patch's own `+`/`-` lines, and never
 add or drop files in the patch. For example, do not drop the prefill delegation
 guard (`if (S > 1 && !lumi_layer_on(layer))` in
 `engine_patches/make_patches.py`): matching output tokens do not prove the
 gateway still delegates prompt prefill.
- If the patch cannot be rebased without editing its own lines, stop. Open the PR
 with `<!-- upstream-autofix-needs-human -->` on its own line in the body,
 explain what upstream changed, and leave the decision to a human.
- `.github/workflows/upstream-automerge.yml` enforces this with
 `scripts/check-gateway-patch-content.mts`; a violating PR is not auto-merged and
 is labelled `autofix:needs-human`.

## Dependency updates

- Dependabot groups production npm bumps, TypeScript tooling bumps, transitive npm bumps, and GitHub Actions bumps into separate pull requests.
- Do not accept a Dependabot bump of `@qvac/sdk`, `@qvac/cli`, or a routine Zod bump. Those versions come from `contracts.json`. A Zod security pull request must change `runtime.zod.tested` in the same change.
- Keep TypeScript on 5.9.x and `@types/node` on 20.x. Majors are outside this release's Node range.

## Upstream autofix workflows

- Do not change `CURSOR_API_KEY` values or billing settings in the repo.
- To verify workflows without a failed canary: use **workflow_dispatch** on
  **Upstream autofix** with `force_launch` (see workflow header comments).
- Auto-merge is gated on Cursor API agent metadata; see
  `.github/workflows/upstream-automerge.yml`.
