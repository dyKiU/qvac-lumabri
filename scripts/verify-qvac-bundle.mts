import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'

interface BundleManifest {
  version: number
  addons: string[]
  bundleId: string
}

const qvacDir = new URL('../qvac/', import.meta.url)
const entry = await readFile(new URL('worker.entry.mjs', qvacDir), 'utf8')

assert(entry.includes('@lumabri/qvac-adapter/plugin'), 'adapter plugin missing from worker entry')
const pluginImport = entry.match(/import\s+(\w+)\s+from\s+['"]@lumabri\/qvac-adapter\/plugin['"]/)
assert(pluginImport, 'adapter plugin import missing from worker entry')
const pluginVar = pluginImport[1]!
const registered =
  entry.includes(`registerPlugin(${pluginVar})`) ||
  new RegExp(`plugins:\\s*\\[[^\\]]*\\b${pluginVar}\\b`).test(entry)
assert(registered, 'adapter plugin is not registered')

async function exists(url: URL): Promise<boolean> {
  try {
    await access(url, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const manifestPath = new URL('addons.manifest.json', qvacDir)
if (await exists(manifestPath)) {
  const manifest: BundleManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.version, 1)
  assert(manifest.addons.includes('bare-subprocess'), 'Bare subprocess addon missing from manifest')
  assert.match(manifest.bundleId, /^[0-9a-f]{64}$/)
  process.stdout.write(`QVAC bundle: PASS (${manifest.bundleId})\n`)
} else {
  const bundleCandidates = ['worker/index.bundle', 'worker.bundle.js', 'worker']
  let bundlePath = ''
  for (const relative of bundleCandidates) {
    if (await exists(new URL(relative, qvacDir))) {
      bundlePath = relative
      break
    }
  }
  assert(bundlePath, 'bundle artifact missing (expected worker bundle output)')
  process.stdout.write(`QVAC bundle: PASS (${bundlePath}, no addons manifest)\n`)
}