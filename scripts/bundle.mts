import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { URL } from 'node:url'

import { bundleSdk } from '@qvac/sdk/commands'

const result = await bundleSdk({ projectRoot: process.cwd() })
const bundleBytes = await readFile(result.bundlePath)
const manifest = {
  version: 1,
  addons: result.addons,
  bundleId: createHash('sha256').update(bundleBytes).digest('hex')
}
await writeFile(
  new URL('../qvac/addons.manifest.json', import.meta.url),
  `${JSON.stringify(manifest, null, 2)}\n`
)
