import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const roots = ['client.js', 'plugin.js', 'lib', 'scripts', 'test']
const files = []

async function walk(relative) {
  const absolute = path.join(root, relative)
  const entries = await readdir(absolute, { withFileTypes: true }).catch(() => null)
  if (!entries) {
    files.push(relative)
    return
  }
  for (const entry of entries) {
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) await walk(child)
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(child)
  }
}

for (const entry of roots) await walk(entry)

for (const file of files) {
  const source = await readFile(path.join(root, file), 'utf8')
  assert(!source.includes('\r'), `${file} contains CRLF bytes`)
  if (file === 'client.js') {
    assert(!/from ['"]node:/.test(source), 'client.js must remain usable outside Node')
  }
}

assert(files.includes('plugin.js'))
assert(files.includes(path.join('lib', 'gateway-client.js')))
process.stdout.write(`Source checks: PASS (${files.length} files)\n`)
