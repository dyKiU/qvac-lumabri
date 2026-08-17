import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readJson = async (name) => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url)))
const [pkg, compatibility, qvacConfig] = await Promise.all([
  readJson('package.json'),
  readJson('compatibility.json'),
  readJson('qvac.config.json')
])

function tuple(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  assert(match, `invalid version: ${version}`)
  return match.slice(1).map(Number)
}

function compare(a, b) {
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

function inBoundedRange(version, range) {
  const match = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/.exec(range)
  assert(match, `unsupported range syntax: ${range}`)
  const value = tuple(version)
  return compare(value, tuple(match[1])) >= 0 && compare(value, tuple(match[2])) < 0
}

assert.equal(compatibility.schemaVersion, 1)
assert.equal(compatibility.gatewayProtocol, 1)
assert.equal(pkg.engines.node, compatibility.node.range)
assert.equal(pkg.peerDependencies['@qvac/sdk'], compatibility.qvac.sdkRange)
assert.equal(pkg.devDependencies['@qvac/sdk'], compatibility.qvac.publishedSdk)
assert.equal(pkg.devDependencies['@qvac/cli'], compatibility.qvac.publishedCli)
assert(inBoundedRange(compatibility.qvac.publishedSdk, compatibility.qvac.sdkRange))
assert.equal(pkg.peerDependencies.zod, compatibility.zod.range)
assert.equal(pkg.devDependencies.zod, compatibility.zod.published)
assert(inBoundedRange(compatibility.zod.published, compatibility.zod.range))
assert(qvacConfig.plugins.includes('@lumabri/qvac-adapter/plugin'))
tuple(compatibility.verification.numpy)

for (const component of ['qvac', 'lumabri', 'colibri']) {
  assert.match(compatibility[component].sourceRef, /^[0-9a-f]{40}$/)
  assert.equal(compatibility[component].headRef, 'main')
}

process.stdout.write('Compatibility manifest: PASS\n')
