import assert from 'node:assert/strict'
import test from 'node:test'

import { refreshCandidateContract } from '../scripts/refresh-candidate-pins.mts'

const contract = {
  status: 'candidate',
  lumabri: {
    releaseBase: 'v0.8.0',
    sourceRef: '941a2d03b390391a841782f1e70df39d5b4aa71f',
    gatewayPatch: 'native/lumabri-gateway-main.patch'
  },
  colibri: {
    release: 'v2.0.0',
    sourceRef: 'bf2442915d6e3dd4cdfd2eb9c2a3d2aa44a25850'
  },
  qvac: {
    sdk: '0.21.0',
    cli: '0.15.0',
    sdkGitHead: 'ffff93cc7c31ea12c547c4b6bbfce4168f6a8e2c',
    cliGitHead: 'c5ea23c997e1421e34aae436508e73af7d9e0972',
    sourceRef: 'ffff93cc7c31ea12c547c4b6bbfce4168f6a8e2c',
    delegatedPluginRpc: false
  }
}

const live = {
  lumabri: {
    head: 'a0b0463abd9f7a22ea0e3c001f96ba1ffe8d653f',
    release: 'v0.8.0'
  },
  colibri: {
    head: 'e0db083cdc9e563e0766cc6fc661ef23c32298e0',
    release: 'v2.0.0'
  },
  qvac: {
    sdk: { version: '0.22.0', gitHead: '9e6db51af45d97851c5cae675b099d2864b9fb5c' },
    cli: { version: '0.16.0', gitHead: '1e5b13d9f657e565321b50f78caf95bd13fc49ed' }
  }
}

test('moves dev-next onto main and npm latest without dropping other fields', () => {
  const refreshed = refreshCandidateContract(contract, live)
  assert.equal(refreshed.contract.lumabri.gatewayPatch, 'native/lumabri-gateway-main.patch')
  assert.equal(refreshed.contract.qvac.delegatedPluginRpc, false)
  assert.equal(refreshed.contract.lumabri.sourceRef, live.lumabri.head)
  assert.equal(refreshed.contract.colibri.sourceRef, live.colibri.head)
  assert.equal(refreshed.contract.qvac.sourceRef, live.qvac.sdk.gitHead)
  assert.deepEqual(refreshed.changes, [
    `lumabri.sourceRef: ${contract.lumabri.sourceRef} -> ${live.lumabri.head}`,
    `colibri.sourceRef: ${contract.colibri.sourceRef} -> ${live.colibri.head}`,
    'qvac.sdk: 0.21.0 -> 0.22.0',
    'qvac.cli: 0.15.0 -> 0.16.0',
    `qvac.sdkGitHead: ${contract.qvac.sdkGitHead} -> ${live.qvac.sdk.gitHead}`,
    `qvac.cliGitHead: ${contract.qvac.cliGitHead} -> ${live.qvac.cli.gitHead}`,
    `qvac.sourceRef: ${contract.qvac.sourceRef} -> ${live.qvac.sdk.gitHead}`
  ])
})

test('reports no changes when dev-next already matches live upstreams', () => {
  const once = refreshCandidateContract(contract, live)
  const twice = refreshCandidateContract(once.contract, live)
  assert.deepEqual(twice.changes, [])
})
