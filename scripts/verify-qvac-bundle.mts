import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, readdir, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'

interface BundleManifest {
  version: number
  addons: string[]
  bundleId: string
}

async function exists(url: URL): Promise<boolean> {
  try {
    await access(url, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const entry = await readFile(new URL('../qvac/worker.entry.mjs', import.meta.url), 'utf8')
assert(entry.includes('@lumabri/qvac-adapter/plugin'), 'adapter plugin missing from worker entry')
assert(
  entry.includes('registerPlugin(customPlugin0)') ||
    /plugins:\s*\[\s*customPlugin0\s*]/.test(entry),
  'adapter plugin is not registered'
)

const legacyManifestUrl = new URL('../qvac/addons.manifest.json', import.meta.url)
let bundleId: string

if (await exists(legacyManifestUrl)) {
  const manifest: BundleManifest = JSON.parse(await readFile(legacyManifestUrl, 'utf8'))
  assert.equal(manifest.version, 1)
  assert(manifest.addons.includes('bare-subprocess'), 'Bare subprocess addon missing from manifest')
  assert.match(manifest.bundleId, /^[0-9a-f]{64}$/)
  bundleId = manifest.bundleId
} else {
  const bundleUrl = new URL('../qvac/worker/index.bundle', import.meta.url)
  assert(await exists(bundleUrl), 'worker/index.bundle missing from bundle output')
  const addonsRoot = fileURLToPath(
    new URL('../qvac/worker/index.bundle.d/node_modules/', import.meta.url)
  )
  const addons = await exists(new URL('../qvac/worker/index.bundle.d/node_modules/', import.meta.url))
    ? await readdir(addonsRoot)
    : []
  assert(addons.includes('bare-subprocess'), 'Bare subprocess addon missing from bundle layout')
  const bundle = await readFile(bundleUrl)
  bundleId = createHash('sha256').update(bundle).digest('hex')
}

process.stdout.write(`QVAC bundle: PASS (${bundleId})\n`)