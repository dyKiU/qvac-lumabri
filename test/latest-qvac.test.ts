import assert from 'node:assert/strict'
import test from 'node:test'

import { applyLatestQvacRelease, qvacPinDrift } from '../scripts/with-latest-qvac.mts'

const latest = {
  sdk: {
    version: '0.22.0',
    gitHead: '9e6db51af45d97851c5cae675b099d2864b9fb5c'
  },
  cli: {
    version: '0.16.0',
    gitHead: '1e5b13d9f657e565321b50f78caf95bd13fc49ed'
  }
}

const candidate = {
  id: 'dev-next',
  status: 'candidate',
  qvac: {
    sdk: '0.21.0',
    sdkGitHead: 'ffff93cc7c31ea12c547c4b6bbfce4168f6a8e2c',
    cli: '0.15.0',
    cliGitHead: 'c5ea23c997e1421e34aae436508e73af7d9e0972',
    sourceRef: 'ffff93cc7c31ea12c547c4b6bbfce4168f6a8e2c',
    delegatedPluginRpc: false
  }
}

const edge = {
  id: 'upstream-head',
  status: 'edge',
  qvac: {
    sdk: 'main',
    cli: 'main',
    sourceRef: 'main',
    delegatedPluginRpc: false
  }
}

test('points the candidate canary at npm latest and leaves edge on main', () => {
  const [nextCandidate, nextEdge] = applyLatestQvacRelease([candidate, edge], latest)

  assert.deepEqual(nextCandidate!.qvac, {
    sdk: latest.sdk.version,
    sdkGitHead: latest.sdk.gitHead,
    cli: latest.cli.version,
    cliGitHead: latest.cli.gitHead,
    sourceRef: latest.sdk.gitHead,
    delegatedPluginRpc: false
  })
  assert.equal(nextEdge, edge)
  assert.deepEqual(qvacPinDrift(candidate.qvac, nextCandidate!.qvac), [
    'sdk: 0.21.0 -> 0.22.0',
    'cli: 0.15.0 -> 0.16.0',
    `sourceRef: ${candidate.qvac.sourceRef} -> ${latest.sdk.gitHead}`,
    `sdkGitHead: ${candidate.qvac.sdkGitHead} -> ${latest.sdk.gitHead}`,
    `cliGitHead: ${candidate.qvac.cliGitHead} -> ${latest.cli.gitHead}`
  ])
})

test('reports no drift when the candidate pin already matches npm latest', () => {
  const [current] = applyLatestQvacRelease([candidate, edge], latest)
  const again = applyLatestQvacRelease([current!, edge], latest)
  assert.deepEqual(qvacPinDrift(current!.qvac, again[0]!.qvac), [])
})

test('requires a candidate contract', () => {
  assert.throws(() => applyLatestQvacRelease([edge], latest), /candidate contract is missing/)
})
