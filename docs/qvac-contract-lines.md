# QVAC contract lines (supported vs candidate)

[`contracts.json`](../contracts.json) defines four lines. Only **`supported`**
lines are what this npm release targets.

## Supported (`stable-0.1`, `stable-0.1-r2`)

- **`peerDependencies['@qvac/sdk']`** in `package.json` lists **only** these
  SDK versions (`0.17.1 || 0.18.1`). `npm install` peer warnings are meaningful
  for production use on a supported line.
- CI **Verify** runs the full matrix against the **primary** supported contract
  (`stable-0.1-r2` devDependencies).
- Lumabri/Colibri pins are exact git SHAs; gateway patch is
  `native/lumabri-gateway.patch`.

## Candidate (`dev-next`)

- Tracks the newest published `@qvac/sdk` and `@qvac/cli`. Upstream
  compatibility runs `npm run check:freshness` on every schedule and push to
  `main`. That check fails when `dev-next` version or `gitHead` lags npm
  `latest`. `qvac.sourceRef` stays the SDK `gitHead`.
- The candidate QVAC canary checks out that same npm latest SDK commit, packs
  it, and runs the adapter against the tarball. A release is therefore built
  on the day it is published, including before `contracts.json` records it.
  Edge stays on git `main`.
- **`npm install` will not satisfy** candidate QVAC versions via
  `peerDependencies` — that is intentional.
- Lumabri and Colibri `sourceRef` values track `main`. Their release tags
  may be older commits. `check:freshness` requires each release tag to be
  the pin or an ancestor of it.
- Uses `native/lumabri-gateway-main.patch` (Lumabri `main`-line pins).

## Edge (`upstream-head`)

- Canary only: QVAC/Lumabri/Colibri at `main`. Not a release promise.

## Promoting a candidate

When `dev-next` is promoted to supported:

1. Add the new QVAC SDK version to `peerDependencies`.
2. Add or update a `supported` contract row; run `npm run docs:contracts`.
3. Run full Verify and release hygiene before publish.

Until then, do not widen `peerDependencies` to candidate SDKs — it would imply
npm-peer satisfaction is enough when native pins and upstream CI are the real gate.
