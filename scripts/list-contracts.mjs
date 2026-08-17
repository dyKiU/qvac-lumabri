import { readFile } from 'node:fs/promises'

const requested = new Set(process.argv.slice(2))
if (requested.size === 0) throw new Error('usage: list-contracts.mjs <status> [status...]')

const matrix = JSON.parse(await readFile(new URL('../contracts.json', import.meta.url), 'utf8'))
const contracts = matrix.contracts.filter((contract) => requested.has(contract.status))
if (contracts.length === 0) throw new Error(`no contracts matched: ${[...requested].join(', ')}`)

process.stdout.write(JSON.stringify(contracts))
