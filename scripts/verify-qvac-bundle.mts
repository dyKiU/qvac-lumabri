import assert from 'node:assert/strict'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface BundleManifest {
  version: number
  addons: string[]
  bundleId: string
}

const qvacRoot = fileURLToPath(new URL('../qvac/', import.meta.url))

async function exists(relative: string): Promise<boolean> {
  try {
    await access(path.join(qvacRoot, relative), constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function bundleIncludesBareSubprocess(): Promise<boolean> {
  const bundleDir = path.join(qvacRoot, 'worker', 'index.bundle.d')
  if (!(await exists('worker/index.bundle.d'))) return false
  const walk = async (dir: string): Promise<boolean> => {
    for (const name of await readdir(dir)) {
      const full = path.join(dir, name)
      const info = await stat(full)
      if (info.isDirectory()) {
        if (await walk(full)) return true
      } else if (name === 'bare-subprocess.bare') {
        return true
      }
    }
    return false
  }
  return walk(bundleDir)
}

const entry = await readFile(path.join(qvacRoot, 'worker.entry.mjs'), 'utf8')
assert(entry.includes('@lumabri/qvac-adapter/plugin'), 'adapter plugin missing from worker entry')
assert(entry.includes('customPlugin0'), 'adapter plugin is not wired into the worker entry')

if (await exists('addons.manifest.json')) {
  const manifest: BundleManifest = JSON.parse(
    await readFile(path.join(qvacRoot, 'addons.manifest.json'), 'utf8')
  )
  assert.equal(manifest.version, 1)
  assert(manifest.addons.includes('bare-subprocess'), 'Bare subprocess addon missing from manifest')
  assert.match(manifest.bundleId, /^[0-9a-f]{64}$/)
  process.stdout.write(`QVAC bundle: PASS (${manifest.bundleId})\n`)
} else {
  assert(await exists('worker/index.bundle'), 'worker bundle missing')
  assert(await bundleIncludesBareSubprocess(), 'Bare subprocess addon missing from bundle')
  const workerPkg = JSON.parse(await readFile(path.join(qvacRoot, 'worker/package.json'), 'utf8'))
  assert.equal(typeof workerPkg.qvacSdkVersion, 'string')
  process.stdout.write(`QVAC bundle: PASS (sdk ${workerPkg.qvacSdkVersion})\n`)
}