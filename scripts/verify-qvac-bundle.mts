import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'

interface BundleManifest {
  version: number
  addons: string[]
  bundleId: string
}

interface WorkerHarness {
  qvacSdkVersion?: string
}

const root = new URL('../qvac/', import.meta.url)
const entryPath = new URL('worker.entry.mjs', root)
const legacyManifestPath = new URL('addons.manifest.json', root)
const stowedBundlePath = new URL('worker/index.bundle', root)
const harnessPath = new URL('worker/package.json', root)
const subprocessAddonPath = new URL(
  'worker/index.bundle.d/node_modules/bare-subprocess',
  root
)

async function exists(file: URL): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

const entry = await readFile(entryPath, 'utf8')
assert(entry.includes('@lumabri/qvac-adapter/plugin'), 'adapter plugin missing from worker entry')
const registered =
  entry.includes('registerPlugin(customPlugin0)') ||
  (entry.includes('startWorker') && entry.includes('customPlugin0'))
assert(registered, 'adapter plugin is not registered')

if (await exists(legacyManifestPath)) {
  const manifest: BundleManifest = JSON.parse(await readFile(legacyManifestPath, 'utf8'))
  assert.equal(manifest.version, 1)
  assert(manifest.addons.includes('bare-subprocess'), 'Bare subprocess addon missing from manifest')
  assert.match(manifest.bundleId, /^[0-9a-f]{64}$/)
  process.stdout.write(`QVAC bundle: PASS (${manifest.bundleId})\n`)
} else {
  assert(await exists(stowedBundlePath), 'stowed worker bundle missing (qvac/worker/index.bundle)')
  const bundle = await readFile(stowedBundlePath)
  const bundleId = createHash('sha256').update(bundle).digest('hex')
  assert.match(bundleId, /^[0-9a-f]{64}$/)
  assert(await exists(harnessPath), 'worker harness package.json missing')
  const harness: WorkerHarness = JSON.parse(await readFile(harnessPath, 'utf8'))
  assert(typeof harness.qvacSdkVersion === 'string' && harness.qvacSdkVersion.length > 0)
  assert(
    await exists(subprocessAddonPath),
    'Bare subprocess addon missing from stowed bundle'
  )
  process.stdout.write(`QVAC bundle: PASS (${bundleId}, stowed)\n`)
}
