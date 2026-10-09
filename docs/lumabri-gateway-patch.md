# Lumabri gateway patch maintenance

Until Lumabri ships an equivalent **`lumabri gateway`** and P2P hooks upstream,
this repository carries git patches under `native/`:

| Patch | Used by |
| --- | --- |
| `native/lumabri-gateway.patch` | Supported contract lines (`stable-*`) |
| `native/lumabri-gateway-main.patch` | `dev-next` and `upstream-head` (Lumabri main) |

Patches add:

- NDJSON **gateway** command in `lumabri.c` (QVAC adapter transport)
- Colibri engine **P2P delegation** hooks in `engine_patches/*`
- `gateway_test.sh` contract test used in CI

## When upstream moves

**Upstream compatibility** fails when Lumabri `main` or Colibri changes and the
patch no longer applies. Typical fix:

1. Check out Lumabri at the **old** pinned SHA from `contracts.json`, apply the
   current patch, commit the overlay (or use the last known-good overlay).
2. Rebase that overlay onto the **new** Lumabri `sourceRef` (merge conflicts
   often appear in `engine_patches/make_patches.py`,
   `engine_patches/deepseek_v4_p2p.py`, and `lumabri.c` when upstream refactors
   serve-codec or Qwen3.6 hooks).
3. Regenerate the patch file from the diff against vanilla Lumabri at the new
   base: `git diff <new-base>...` → update `native/lumabri-gateway-main.patch`.
4. Bump `dev-next` Lumabri `sourceRef` in `contracts.json`; run
   `npm run check`, `check:native-upstreams`, `check:freshness`, `docs:contracts`.

`scripts/apply-lumabri-gateway.sh` runs `git apply --check` first; on failure
it prints remediation hints.

## Long-term direction

The maintainable end state is **upstream Lumabri** (and Colibri) absorbing the
gateway protocol and P2P hooks so this repo only pins SHAs — no patch file.
Track that as an upstream feature request; until then, expect periodic rebases
when `check:native-upstreams` or the upstream-head CI job fails.

## Autofix automation (optional)

When **Upstream compatibility** fails on `main`, `.github/workflows/upstream-autofix.yml`
can launch a Cursor Cloud Agent (requires `CURSOR_API_KEY`). The workflow sets
`CURSOR_AGENT_MODEL` (default `composer-2.5`) and passes it as `model.id` on
`POST https://api.cursor.com/v1/agents`. Verification without spending agent credits:

1. **Workflow parse / key smoke test:** Actions → **Upstream autofix** →
   **Run workflow** → enable **`force_launch`** (minimal API call, no PR).
2. **Full chain (after a real upstream failure):** confirm a `workflow_run`
   fired, agent PR includes `<!-- upstream-autofix -->` and token markers,
   **Verify** passes, then **Auto-merge upstream autofix** queues merge only
   when Cursor API metadata matches (see that workflow).

Do not rely on auto-merge until repository **Allow auto-merge** and
`CURSOR_API_KEY` are configured.
