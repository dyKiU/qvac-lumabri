import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { type QvacLatestRelease } from './with-latest-qvac.mts'

interface NativeHead {
  head: string
  release: string
}

export interface CandidateContract {
  status: string
  lumabri: {
    releaseBase?: string
    sourceRef: string
  }
  colibri: {
    release?: string
    sourceRef: string
  }
  qvac: {
    sdk: string
    cli: string
    sourceRef: string
    sdkGitHead?: string
    cliGitHead?: string
  }
}

export interface LiveCandidatePins {
  lumabri: NativeHead
  colibri: NativeHead
  qvac: QvacLatestRelease
}

export function refreshCandidateContract<T extends CandidateContract>(
  contract: T,
  live: LiveCandidatePins
): { contract: T; changes: string[] } {
  const changes: string[] = []
  const note = (field: string, before: string | undefined, after: string) => {
    if (before === after) return
    changes.push(`${field}: ${before ?? ''} -> ${after}`)
  }
  note('lumabri.releaseBase', contract.lumabri.releaseBase, live.lumabri.release)
  note('lumabri.sourceRef', contract.lumabri.sourceRef, live.lumabri.head)
  note('colibri.release', contract.colibri.release, live.colibri.release)
  note('colibri.sourceRef', contract.colibri.sourceRef, live.colibri.head)
  note('qvac.sdk', contract.qvac.sdk, live.qvac.sdk.version)
  note('qvac.cli', contract.qvac.cli, live.qvac.cli.version)
  note('qvac.sdkGitHead', contract.qvac.sdkGitHead, live.qvac.sdk.gitHead)
  note('qvac.cliGitHead', contract.qvac.cliGitHead, live.qvac.cli.gitHead)
  note('qvac.sourceRef', contract.qvac.sourceRef, live.qvac.sdk.gitHead)
  return {
    contract: {
      ...contract,
      lumabri: {
        ...contract.lumabri,
        releaseBase: live.lumabri.release,
        sourceRef: live.lumabri.head
      },
      colibri: {
        ...contract.colibri,
        release: live.colibri.release,
        sourceRef: live.colibri.head
      },
      qvac: {
        ...contract.qvac,
        sdk: live.qvac.sdk.version,
        cli: live.qvac.cli.version,
        sdkGitHead: live.qvac.sdk.gitHead,
        cliGitHead: live.qvac.cli.gitHead,
        sourceRef: live.qvac.sdk.gitHead
      }
    },
    changes
  }
}

async function main(): Promise<void> {
  const matrixUrl = new URL('../contracts.json', import.meta.url)
  const matrix = JSON.parse(await readFile(matrixUrl, 'utf8')) as {
    contracts: CandidateContract[]
    repositories: { lumabri: string; colibri: string }
  }
  const index = matrix.contracts.findIndex((contract) => contract.status === 'candidate')
  if (index < 0) throw new Error('candidate contract is missing')
  const { npmLatest, githubHead } = await loadLive()
  const { contract, changes } = refreshCandidateContract(matrix.contracts[index]!, {
    lumabri: await githubHead(matrix.repositories.lumabri),
    colibri: await githubHead(matrix.repositories.colibri),
    qvac: {
      sdk: await npmLatest('@qvac/sdk'),
      cli: await npmLatest('@qvac/cli')
    }
  })
  if (changes.length === 0) {
    process.stdout.write('Candidate pins: CURRENT\n')
    return
  }
  matrix.contracts[index] = contract
  await writeFile(matrixUrl, `${JSON.stringify(matrix, null, 2)}\n`)
  for (const change of changes) process.stdout.write(`${change}\n`)
  process.stdout.write('Candidate pins: UPDATED\n')
}

async function loadLive(): Promise<{
  npmLatest: (name: string) => Promise<{ version: string; gitHead: string }>
  githubHead: (repository: string) => Promise<NativeHead>
}> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return {
    npmLatest: async (name) => {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
      const metadata = await response.json() as {
        'dist-tags': { latest: string }
        versions: Record<string, { gitHead?: string }>
      }
      const version = metadata['dist-tags'].latest
      const gitHead = metadata.versions[version]?.gitHead ?? ''
      if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[0-9a-f]{40}$/.test(gitHead)) {
        throw new Error(`${name}@${version}: missing gitHead`)
      }
      return { version, gitHead }
    },
    githubHead: async (repository) => {
      const slug = new URL(repository).pathname.replace(/\.git$/, '').replace(/^\//, '')
      const [headResponse, releaseResponse] = await Promise.all([
        fetch(`https://api.github.com/repos/${slug}/commits/main`, { headers }),
        fetch(`https://api.github.com/repos/${slug}/releases/latest`, { headers })
      ])
      if (!headResponse.ok) throw new Error(`${slug} main: HTTP ${headResponse.status}`)
      if (!releaseResponse.ok) throw new Error(`${slug} release: HTTP ${releaseResponse.status}`)
      const head = await headResponse.json() as { sha: string }
      const release = await releaseResponse.json() as { tag_name: string }
      return { head: head.sha, release: release.tag_name }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
