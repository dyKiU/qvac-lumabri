import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const matrix = JSON.parse(await readFile(new URL('../contracts.json', import.meta.url), 'utf8'))
const candidate = matrix.contracts.find((contract) => contract.status === 'candidate')
assert(candidate, 'candidate contract is missing')

const githubHeaders = { Accept: 'application/vnd.github+json' }
if (process.env.GITHUB_TOKEN) githubHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

async function json(url, options) {
  const response = await fetch(url, options)
  assert(response.ok, `${url}: HTTP ${response.status}`)
  return await response.json()
}

async function npmLatest(name) {
  const metadata = await json(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
  return metadata['dist-tags'].latest
}

function repositorySlug(repository) {
  return new URL(repository).pathname.replace(/\.git$/, '').replace(/^\//, '')
}

async function githubLatest(repository) {
  const slug = repositorySlug(repository)
  const release = await json(`https://api.github.com/repos/${slug}/releases/latest`, {
    headers: githubHeaders
  })
  return release.tag_name
}

async function githubTagCommit(repository, tag) {
  const slug = repositorySlug(repository)
  let object = (await json(`https://api.github.com/repos/${slug}/git/ref/tags/${encodeURIComponent(tag)}`, {
    headers: githubHeaders
  })).object
  while (object.type === 'tag') object = (await json(object.url, { headers: githubHeaders })).object
  assert.equal(object.type, 'commit', `${tag}: tag does not resolve to a commit`)
  return object.sha
}

async function githubRelation(repository, base, head) {
  const slug = repositorySlug(repository)
  return (await json(`https://api.github.com/repos/${slug}/compare/${base}...${head}`, {
    headers: githubHeaders
  })).status
}

const actual = {
  qvacSdk: await npmLatest('@qvac/sdk'),
  qvacCli: await npmLatest('@qvac/cli'),
  lumabri: await githubLatest(matrix.repositories.lumabri),
  colibri: await githubLatest(matrix.repositories.colibri)
}
const expected = {
  qvacSdk: candidate.qvac.sdk,
  qvacCli: candidate.qvac.cli,
  lumabri: candidate.lumabri.releaseBase,
  colibri: candidate.colibri.release
}

assert.deepEqual(actual, expected, `candidate contract is stale\nexpected ${JSON.stringify(expected)}\nactual   ${JSON.stringify(actual)}`)
assert.equal(candidate.qvac.release, `sdk-v${candidate.qvac.sdk}`)

const [qvacRef, lumabriBaseRef, colibriRef] = await Promise.all([
  githubTagCommit(matrix.repositories.qvac, candidate.qvac.release),
  githubTagCommit(matrix.repositories.lumabri, candidate.lumabri.releaseBase),
  githubTagCommit(matrix.repositories.colibri, candidate.colibri.release)
])
assert.equal(candidate.qvac.sourceRef, qvacRef, 'QVAC candidate SHA does not match its release tag')
assert.equal(candidate.colibri.sourceRef, colibriRef, 'Colibri candidate SHA does not match its release tag')
const lumabriRelation = await githubRelation(
  matrix.repositories.lumabri,
  lumabriBaseRef,
  candidate.lumabri.sourceRef
)
assert(['ahead', 'identical'].includes(lumabriRelation), 'Lumabri candidate is not based on its release')
process.stdout.write(`Candidate freshness: PASS (${Object.values(actual).join(', ')})\n`)
