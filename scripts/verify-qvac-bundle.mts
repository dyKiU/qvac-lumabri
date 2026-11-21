import assert from 'node:assert/strict'
import { access, readFile, stat } from 'node:fs/promises'

interface BundleManifest {
  version: number
  addons: string[]
  bundleId: string
}

const qvacDir = new URL('../qvac/', import.meta.url)
const entry = await readFile(new URL('worker.entry.mjs', qvacDir), 'utf8')

assert(entry.includes('@lumabri/qvac-adapter/plugin'), 'adapter plugin missing from worker entry')
assert(entry.includes('customPlugin0'), 'adapter plugin binding missing from worker entry')
assert(
  entry.includes('registerPlugin(customPlugin0)') ||
    (entry.includes('startWorker(') && entry.includes('plugins:') && entry.includes('customPlugin0')),
  'adapter plugin is not registered'
)

async function exists(url: URL): Promise<boolean> {
  try {
    await access(url)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const manifestUrl = new URL('addons.manifest.json', qvacDir)
if (await exists(manifestUrl)) {
  const manifest: BundleManifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
  assert.equal(manifest.version, 1)
  assert(manifest.addons.includes('bare-subprocess'), 'Bare subprocess addon missing from manifest')
  assert.match(manifest.bundleId, /^[0-9a-f]{64}$/)
  process.stdout.write(`QVAC bundle: PASS (${manifest.bundleId})\n`)
} else {
  const bundleUrl = (await exists(new URL('worker/index.bundle', qvacDir)))
    ? new URL('worker/index.bundle', qvacDir)
    : new URL('worker.bundle.js', qvacDir)
  assert(await exists(bundleUrl), 'worker bundle artifact missing')
  const { size } = await stat(bundleUrl)
  assert(size > 0, 'worker bundle is empty')
  process.stdout.write(`QVAC bundle: PASS (${bundleUrl.pathname.split('/').pop()})\n`)
}