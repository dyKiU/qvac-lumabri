import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const ignored = new Set([
  '.git',
  'node_modules',
  'qvac',
  '.upstream',
  '.cache',
  '.verification-venv',
  'coverage'
])
const files = []

async function walk(relative = '.') {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) await walk(child)
    else if (!entry.name.endsWith('.tgz')) files.push(child)
  }
}

await walk()

const forbidden = [
  { name: 'macOS home path', pattern: /\/Users\//i },
  { name: 'Linux home path', pattern: /\/home\/[A-Za-z0-9._-]+\//i },
  { name: 'Windows home path', pattern: /[A-Za-z]:\\Users\\/i },
  { name: 'local account name', pattern: new RegExp(['pja', 'eckel'].join(''), 'i') },
  { name: 'development hostname', pattern: new RegExp(`\\b${['ac', 'er'].join('')}\\b`, 'i') },
  { name: 'private key material', pattern: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { name: 'assigned secret', pattern: /(?:QVAC_HYPERSWARM_SEED|LUMABRI_TOKEN)\s*=\s*[^\s#]+/ },
  { name: 'email address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i }
]

for (const file of files) {
  const content = await readFile(path.join(root, file), 'utf8').catch(() => '')
  for (const rule of forbidden) {
    assert(!rule.pattern.test(content), `${file}: found ${rule.name}`)
  }
}

process.stdout.write(`Release hygiene: PASS (${files.length} files)\n`)
