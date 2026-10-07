import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

interface BundleManifest {
  version: number
  addons: string[]
  bundleId: string
}

const entry = await readFile(new URL('../qvac/worker.entry.mjs', import.meta.url), 'utf8')
const manifest: BundleManifest = JSON.parse(
  await readFile(new URL('../qvac/addons.manifest.json', import.meta.url), 'utf8')
)

assert(entry.includes('@lumabri/qvac-adapter/plugin'), 'adapter plugin missing from worker entry')
assert(entry.includes('registerPlugin(customPlugin0)'), 'adapter plugin is not registered')
assert.equal(manifest.version, 1)
assert(manifest.addons.includes('bare-subprocess'), 'Bare subprocess addon missing from manifest')
assert.match(manifest.bundleId, /^[0-9a-f]{64}$/)

process.stdout.write(`QVAC bundle: PASS (${manifest.bundleId})\n`)
