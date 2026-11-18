import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { formatVerifyBundleResult, hasErrors, verifyBundle } from '@qvac/sdk/commands'

interface BundleManifest {
  version: number
  addons: string[]
  bundleId: string
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const entryPath = new URL('../qvac/worker.entry.mjs', import.meta.url)
const legacyManifestPath = new URL('../qvac/addons.manifest.json', import.meta.url)
const bareSidecarBundlePath = new URL('../qvac/worker/index.bundle', import.meta.url)
const harnessPackagePath = new URL('../qvac/worker/package.json', import.meta.url)

const entry = await readFile(entryPath, 'utf8')

assert(entry.includes('@lumabri/qvac-adapter/plugin'), 'adapter plugin missing from worker entry')
const registersPlugin =
  entry.includes('registerPlugin(customPlugin0)') ||
  /plugins:\s*\[customPlugin0\]/.test(entry)
assert(registersPlugin, 'adapter plugin is not registered')

async function legacyManifestExists(): Promise<boolean> {
  try {
    await access(legacyManifestPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

if (await legacyManifestExists()) {
  const manifest: BundleManifest = JSON.parse(await readFile(legacyManifestPath, 'utf8'))
  assert.equal(manifest.version, 1)
  assert(manifest.addons.includes('bare-subprocess'), 'Bare subprocess addon missing from manifest')
  assert.match(manifest.bundleId, /^[0-9a-f]{64}$/)
  process.stdout.write(`QVAC bundle: PASS (${manifest.bundleId})\n`)
} else {
  const result = await verifyBundle({
    projectRoot,
    addonsSource: fileURLToPath(bareSidecarBundlePath),
    hosts: ['linux-x64']
  })
  if (hasErrors(result)) throw new Error(formatVerifyBundleResult(result))
  assert(
    result.addons.some((addon) => addon.name === 'bare-subprocess'),
    'Bare subprocess addon missing from bundle'
  )
  const harness = JSON.parse(await readFile(harnessPackagePath, 'utf8')) as {
    qvacSdkVersion?: string
    qvacTarget?: string
  }
  assert.equal(typeof harness.qvacSdkVersion, 'string')
  assert.equal(typeof harness.qvacTarget, 'string')
  process.stdout.write(`QVAC bundle: PASS (${harness.qvacSdkVersion}, ${harness.qvacTarget})\n`)
}