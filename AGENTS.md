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
