# Native Lumabri build (not in the npm package)

The published npm package **`@lumabri/qvac-adapter`** contains the QVAC plugin,
TypeScript client helpers, and [`contracts.json`](../contracts.json). It does
**not** include `native/*.patch` or a built `lumabri gateway` binary.

Running real inference requires:

1. A **git checkout** of this repository (or another source for the patches).
2. Clones of **Lumabri** and **Colibri** at the SHAs pinned for your contract line.
3. Applying the matching gateway patch and building Lumabri/Colibri artifacts.

## Pick pins from your contract line

Open [`contracts.json`](../contracts.json) and use the entry you target (for
example `stable-0.1-r2` for current supported primary, or `dev-next` for the
candidate canary):

| Field | Meaning |
| --- | --- |
| `lumabri.sourceRef` | Git commit to check out in the Lumabri repo |
| `lumabri.gatewayPatch` | Patch file under `native/` in **this** repo |
| `colibri.sourceRef` | Git commit for Colibri (usually a release tag) |

Supported lines use `native/lumabri-gateway.patch`. The `dev-next` and
`upstream-head` lines use `native/lumabri-gateway-main.patch`.

## Build steps

From the root of a **qvac-lumabri** git clone:

```sh
git clone https://github.com/JustVugg/lumabri.git .upstream/lumabri
git clone https://github.com/JustVugg/colibri.git .upstream/colibri
git -C .upstream/lumabri checkout <lumabri.sourceRef>
git -C .upstream/colibri checkout <colibri.sourceRef>
scripts/apply-lumabri-gateway.sh .upstream/lumabri <lumabri.gatewayPatch>
make -C .upstream/lumabri lumabri colibri_p2p expert_node_glm ENGINE=../colibri/c
```

Point QVAC at the built gateway (see root [README](../README.md) `modelConfig`).

## npm-only installs

`npm install @lumabri/qvac-adapter` is enough for **JavaScript integration and
CI-style checks** that do not spawn a real gateway. It is **not** enough to
produce or patch Lumabri. Clone this repository when you need native artifacts
or to refresh pins when upstream moves.

Verify what ships in the tarball:

```sh
npm run pack:check
```

The `files` list in `package.json` intentionally excludes `native/`.
