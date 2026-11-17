import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'

interface BundleManifest {
  version: number
  addons: string[]
  bundleId: string
}

interface HarnessPackage {
  qvacSdkVersion?: string
  qvacTarget?: string
}

const root = new URL('..', import.meta.url)

async function exists(url: URL): Promise<boolean> {
  try {
    await access(url, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const entry = await readFile(new URL('qvac/worker.entry.mjs', root), 'utf8')

assert(entry.includes('@lumabri/qvac-adapter/plugin'), 'adapter plugin missing from worker entry')
assert(
  entry.includes('registerPlugin(customPlugin0)') ||
    entry.includes('plugins: [customPlugin0]'),
  'adapter plugin is not registered'
)

const manifestPath = new URL('qvac/addons.manifest.json', root)
if (await exists(manifestPath)) {
  const manifest: BundleManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.version, 1)
  assert(manifest.addons.includes('bare-subprocess'), 'Bare subprocess addon missing from manifest')
  assert.match(manifest.bundleId, /^[0-9a-f]{64}$/)
  process.stdout.write(`QVAC bundle: PASS (${manifest.bundleId})\n`)
} else {
  const harness: HarnessPackage = JSON.parse(
    await readFile(new URL('qvac/worker/package.json', root), 'utf8')
  )
  assert.match(harness.qvacSdkVersion ?? '', /^\d+\.\d+\.\d+$/, 'bundled SDK version missing')
  assert.equal(harness.qvacTarget, 'bare-sidecar', 'unexpected bare harness target')
  const addonRoot = fileURLToPath(new URL('qvac/worker/index.bundle.d/node_modules', root))
  const addons = await readdir(addonRoot)
  assert(addons.includes('bare-subprocess'), 'Bare subprocess addon missing from bundle tree')
  process.stdout.write(`QVAC bundle: PASS (${harness.qvacSdkVersion} / ${harness.qvacTarget})\n`)
}