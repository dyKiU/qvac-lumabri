import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { GATEWAY_PROTOCOL_VERSION } from '../lib/gateway-client.js'

const readJson = async (name) => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url)))
const [pkg, matrix, qvacConfig, readme] = await Promise.all([
  readJson('package.json'),
  readJson('contracts.json'),
  readJson('qvac.config.json'),
  readFile(new URL('../README.md', import.meta.url), 'utf8')
])

const shaPattern = /^[0-9a-f]{40}$/
const exactVersionPattern = /^\d+\.\d+\.\d+$/
const allowedStatuses = new Set(['supported', 'candidate', 'edge'])
const requiredProof = new Set(['unit', 'bundle', 'gateway', 'native-build', 'token-identity'])

function releaseLine(version) {
  const match = /^(\d+)\.(\d+)\.\d+$/.exec(version)
  assert(match, `invalid package version: ${version}`)
  return `${match[1]}.${match[2]}.x`
}

function assertRef(contract, component) {
  const ref = contract[component].sourceRef
  if (contract.status === 'edge') assert.equal(ref, 'main', `${contract.id}: ${component} edge ref`)
  else assert.match(ref, shaPattern, `${contract.id}: ${component} must use an exact SHA`)
}

assert.equal(matrix.schemaVersion, 1)
assert.deepEqual(matrix.gateway.supported, [matrix.gateway.preferred])
assert.equal(matrix.gateway.preferred, GATEWAY_PROTOCOL_VERSION)
assert.equal(pkg.engines.node, matrix.runtime.node.range)
assert.deepEqual(matrix.runtime.node.tested, ['20', '22'])
assert.equal(pkg.peerDependencies.zod, matrix.runtime.zod.range)
assert.equal(pkg.devDependencies.zod, matrix.runtime.zod.tested)
assert.match(matrix.runtime.numpy, exactVersionPattern)
assert(qvacConfig.plugins.includes('@lumabri/qvac-adapter/plugin'))

const ids = new Set()
for (const contract of matrix.contracts) {
  assert.match(contract.id, /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)
  assert(!ids.has(contract.id), `duplicate contract id: ${contract.id}`)
  ids.add(contract.id)
  assert(allowedStatuses.has(contract.status), `${contract.id}: invalid status`)
  assert(matrix.gateway.supported.includes(contract.gatewayProtocol), `${contract.id}: unsupported gateway protocol`)
  assert.equal(contract.lumabri.gatewayPatch, 'native/lumabri-gateway.patch')
  for (const component of ['qvac', 'lumabri', 'colibri']) assertRef(contract, component)
  if (contract.status !== 'edge') {
    assert.match(contract.qvac.sdkGitHead, shaPattern, `${contract.id}: missing QVAC SDK gitHead`)
    assert.match(contract.qvac.cliGitHead, shaPattern, `${contract.id}: missing QVAC CLI gitHead`)
  }
  assert(Array.isArray(contract.proof) && contract.proof.length > 0, `${contract.id}: missing proof`)
}

const supported = matrix.contracts.filter((contract) => contract.status === 'supported')
assert(supported.length > 0, 'current release must have a supported contract')
const primaryContracts = supported.filter((contract) => contract.primary)
assert.equal(primaryContracts.length, 1, 'current release must have exactly one primary contract')
const primary = primaryContracts[0]
const candidate = matrix.contracts.find((contract) => contract.status === 'candidate')
assert(candidate, 'candidate contract is missing')
assert.equal(candidate.qvac.sourceRef, candidate.qvac.sdkGitHead)
const supportedSdkVersions = [...new Set(supported.map((contract) => contract.qvac.sdk))]
for (const contract of supported) {
  assert.equal(contract.adapter, releaseLine(pkg.version))
  assert.match(contract.qvac.sdk, exactVersionPattern)
  assert.match(contract.qvac.cli, exactVersionPattern)
  for (const proof of requiredProof) assert(contract.proof.includes(proof), `${contract.id}: missing ${proof} proof`)
}
assert.equal(pkg.peerDependencies['@qvac/sdk'], supportedSdkVersions.join(' || '))
assert.equal(pkg.devDependencies['@qvac/sdk'], primary.qvac.sdk)
assert.equal(pkg.devDependencies['@qvac/cli'], primary.qvac.cli)
assert(readme.includes('contracts.json'))
assert(readme.includes(primary.lumabri.sourceRef))
assert(readme.includes(primary.colibri.sourceRef))

for (const status of allowedStatuses) {
  assert(matrix.contracts.some((contract) => contract.status === status), `missing ${status} contract`)
}

process.stdout.write(`Contract matrix: PASS (${matrix.contracts.length} contracts)\n`)
