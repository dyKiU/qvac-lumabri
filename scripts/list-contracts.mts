import { readFile } from 'node:fs/promises'

interface Contract {
  status: string
  [key: string]: unknown
}

interface ContractMatrix {
  contracts: Contract[]
}

const requested = new Set(process.argv.slice(2))
if (requested.size === 0) throw new Error('usage: list-contracts.mts <status> [status...]')

const matrix: ContractMatrix = JSON.parse(await readFile(new URL('../contracts.json', import.meta.url), 'utf8'))
const contracts = matrix.contracts.filter((contract) => requested.has(contract.status))
if (contracts.length === 0) throw new Error(`no contracts matched: ${[...requested].join(', ')}`)

process.stdout.write(JSON.stringify(contracts))
