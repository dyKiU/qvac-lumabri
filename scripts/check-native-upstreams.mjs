import assert from 'node:assert/strict'
import { appendFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function nativeUpstreamChanges(candidate, current) {
  const changes = []
  for (const component of ['lumabri', 'colibri']) {
    const expectedRelease = component === 'lumabri'
      ? candidate.lumabri.releaseBase
      : candidate.colibri.release
    const expectedHead = candidate[component].sourceRef

    if (current[component].head !== expectedHead) {
      changes.push({
        component,
        kind: 'head',
        expected: expectedHead,
        actual: current[component].head
      })
    }
    if (current[component].release !== expectedRelease) {
      changes.push({
        component,
        kind: 'release',
        expected: expectedRelease,
        actual: current[component].release
      })
    }
    if (component === 'colibri' && current.colibri.releaseRef !== expectedHead) {
      changes.push({
        component,
        kind: 'release-ref',
        expected: expectedHead,
        actual: current.colibri.releaseRef
      })
    }
  }
  return changes
}

function repositorySlug(repository) {
  return new URL(repository).pathname.replace(/\.git$/, '').replace(/^\//, '')
}

async function githubJson(url, headers) {
  const response = await fetch(url, { headers })
  assert(response.ok, `${url}: HTTP ${response.status}`)
  return await response.json()
}

async function tagCommit(slug, tag, headers) {
  let object = (await githubJson(
    `https://api.github.com/repos/${slug}/git/ref/tags/${encodeURIComponent(tag)}`,
    headers
  )).object
  while (object.type === 'tag') object = (await githubJson(object.url, headers)).object
  assert.equal(object.type, 'commit', `${slug} ${tag}: tag does not resolve to a commit`)
  return object.sha
}

async function upstreamState(repository, headers) {
  const slug = repositorySlug(repository)
  const [head, release] = await Promise.all([
    githubJson(`https://api.github.com/repos/${slug}/commits/main`, headers),
    githubJson(`https://api.github.com/repos/${slug}/releases/latest`, headers)
  ])
  return {
    head: head.sha,
    release: release.tag_name,
    releaseRef: await tagCommit(slug, release.tag_name, headers)
  }
}

async function main() {
  const matrix = JSON.parse(await readFile(new URL('../contracts.json', import.meta.url)))
  const candidate = matrix.contracts.find((contract) => contract.status === 'candidate')
  assert(candidate, 'candidate contract is missing')

  const headers = { Accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const [lumabri, colibri] = await Promise.all([
    upstreamState(matrix.repositories.lumabri, headers),
    upstreamState(matrix.repositories.colibri, headers)
  ])
  const changes = nativeUpstreamChanges(candidate, { lumabri, colibri })

  if (process.env.GITHUB_OUTPUT) {
    const components = [...new Set(changes.map((change) => change.component))]
    await appendFile(process.env.GITHUB_OUTPUT,
      `changed=${changes.length > 0}\ncomponents=${components.join(',')}\n`)
  }
  if (changes.length > 0) {
    for (const change of changes) {
      process.stderr.write(
        `${change.component} ${change.kind} changed: ${change.expected} -> ${change.actual}\n`
      )
    }
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `Native upstreams: CURRENT (Lumabri ${lumabri.release} @ ${lumabri.head}, ` +
    `Colibri ${colibri.release} @ ${colibri.head})\n`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
