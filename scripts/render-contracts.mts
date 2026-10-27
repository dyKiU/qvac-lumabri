import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

interface ContractComponent {
  release?: string
  baseline?: string
  sourceRef: string
}

interface Contract {
  id: string
  status: string
  adapter: string
  qvac: {
    sdk: string
    cli: string
  }
  gatewayProtocol: number
  lumabri: ContractComponent
  colibri: ContractComponent
}

interface ContractMatrix {
  runtime: {
    node: { range: string }
    zod: { range: string }
    bare: string
  }
  contracts: Contract[]
}

const startMarker = '<!-- contracts:start -->'
const endMarker = '<!-- contracts:end -->'
const runtimeStartMarker = '<!-- runtime:start -->'
const runtimeEndMarker = '<!-- runtime:end -->'
const matrix: ContractMatrix = JSON.parse(await readFile(new URL('../contracts.json', import.meta.url), 'utf8'))
const readmeUrl = new URL('../README.md', import.meta.url)
const readme = await readFile(readmeUrl, 'utf8')

function revision(component: ContractComponent): string {
  const label = component.release ?? component.baseline ?? component.sourceRef
  const suffix = component.sourceRef === 'main' ? '' : ` @ ${component.sourceRef.slice(0, 7)}`
  return `\`${label}${suffix}\``
}

const rows = matrix.contracts.map((contract) => [
  contract.id,
  contract.status,
  contract.adapter,
  `${contract.qvac.sdk} / ${contract.qvac.cli}`,
  `v${contract.gatewayProtocol}`,
  revision(contract.lumabri),
  revision(contract.colibri)
])
const block = [
  startMarker,
  '| Line | Status | Adapter | QVAC SDK / CLI | Gateway | Lumabri | Colibri |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((row) => `| ${row.join(' | ')} |`),
  endMarker
].join('\n')
const runtimeBlock = [
  runtimeStartMarker,
  `Node.js is \`${matrix.runtime.node.range}\`; Zod is \`${matrix.runtime.zod.range}\`. Source-built QVAC workers use Bare runtime \`${matrix.runtime.bare}\`.`,
  runtimeEndMarker
].join('\n')

const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`)
const runtimePattern = new RegExp(`${runtimeStartMarker}[\\s\\S]*?${runtimeEndMarker}`)
assert(pattern.test(readme), 'README contract markers are missing')
assert(runtimePattern.test(readme), 'README runtime markers are missing')
const rendered = readme.replace(pattern, block).replace(runtimePattern, runtimeBlock)

if (process.argv.includes('--write')) {
  await writeFile(readmeUrl, rendered)
  process.stdout.write('README contract docs: UPDATED\n')
} else {
  assert.equal(readme, rendered, 'README contract docs are stale; run npm run docs:contracts')
  process.stdout.write('README contract docs: PASS\n')
}
