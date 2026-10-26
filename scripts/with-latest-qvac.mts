import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export interface NpmPackageRelease {
  version: string
  gitHead: string
}

export interface QvacLatestRelease {
  sdk: NpmPackageRelease
  cli: NpmPackageRelease
}

interface QvacPin {
  sdk: string
  cli: string
  sourceRef: string
  sdkGitHead?: string
  cliGitHead?: string
}

interface Contract {
  status: string
  qvac: QvacPin
}

const exactVersion = /^\d+\.\d+\.\d+$/
const sha = /^[0-9a-f]{40}$/

interface NpmPackageMetadata {
  'dist-tags': { latest: string }
  versions: Record<string, { gitHead?: string }>
}

export function applyLatestQvacRelease<T extends Contract>(contracts: T[], latest: QvacLatestRelease): T[] {
  let seen = false
  const next = contracts.map((contract) => {
    if (contract.status !== 'candidate') return contract
    seen = true
    return {
      ...contract,
      qvac: {
        ...contract.qvac,
        sdk: latest.sdk.version,
        cli: latest.cli.version,
        sdkGitHead: latest.sdk.gitHead,
        cliGitHead: latest.cli.gitHead,
        sourceRef: latest.sdk.gitHead
      }
    }
  })
  if (!seen) throw new Error('candidate contract is missing')
  return next
}

export function qvacPinDrift(before: QvacPin, after: QvacPin): string[] {
  const fields = ['sdk', 'cli', 'sourceRef', 'sdkGitHead', 'cliGitHead'] as const
  return fields.flatMap((field) => {
    if (before[field] === after[field]) return []
    return [`${field}: ${before[field] ?? ''} -> ${after[field] ?? ''}`]
  })
}

async function npmLatest(name: string): Promise<NpmPackageRelease> {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  const metadata = await response.json() as NpmPackageMetadata
  const version = metadata['dist-tags'].latest
  const gitHead = metadata.versions[version]?.gitHead ?? ''
  if (!exactVersion.test(version)) throw new Error(`${name}: invalid latest version ${version}`)
  if (!sha.test(gitHead)) throw new Error(`${name}@${version}: missing gitHead`)
  return { version, gitHead }
}

async function main(): Promise<void> {
  const contracts = JSON.parse(await readFile('/dev/stdin', 'utf8')) as Contract[]
  if (!Array.isArray(contracts)) throw new Error('expected a JSON contract array on stdin')
  const latest = {
    sdk: await npmLatest('@qvac/sdk'),
    cli: await npmLatest('@qvac/cli')
  }
  const candidate = contracts.find((contract) => contract.status === 'candidate')
  const updated = applyLatestQvacRelease(contracts, latest)
  const drifted = qvacPinDrift(candidate!.qvac, updated.find((contract) => contract.status === 'candidate')!.qvac)
  process.stderr.write(
    `Candidate QVAC canary: @qvac/sdk@${latest.sdk.version} ${latest.sdk.gitHead} / @qvac/cli@${latest.cli.version} ${latest.cli.gitHead}\n`
  )
  if (drifted.length > 0) {
    process.stderr.write('contracts.json dev-next pin differs from npm latest:\n')
    for (const line of drifted) process.stderr.write(`  ${line}\n`)
  }
  process.stdout.write(JSON.stringify(updated))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
