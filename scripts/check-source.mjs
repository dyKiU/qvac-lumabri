import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const roots = ['src', 'scripts', 'test']
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
    else if (/\.(?:js|mjs|ts)$/.test(entry.name)) files.push(child)
  }
}

for (const entry of roots) await walk(entry)

for (const file of files) {
  const source = await readFile(path.join(root, file), 'utf8')
  assert(!source.includes('\r'), `${file} contains CRLF bytes`)
  if (file === path.join('src', 'client.ts')) {
    assert(!/from ['"]node:/.test(source), 'src/client.ts must remain usable outside Node')
  }
}

assert(files.includes(path.join('src', 'plugin.ts')))
assert(files.includes(path.join('src', 'lib', 'gateway-client.ts')))
process.stdout.write(`Source checks: PASS (${files.length} files)\n`)
