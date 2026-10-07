import assert from 'node:assert/strict'
import test from 'node:test'

import { nativeUpstreamChanges } from '../scripts/check-native-upstreams.mts'

const candidate = {
  lumabri: {
    releaseBase: 'v0.8.0',
    sourceRef: 'bdfa7cc260e6cc2333f0812b6e4c8b960ffc188a'
  },
  colibri: {
    release: 'v1.12.1',
    sourceRef: 'ce370e87d7b623d7759b52ec2007d75fc5b0e87e'
  }
}

const current = {
  lumabri: {
    head: 'bdfa7cc260e6cc2333f0812b6e4c8b960ffc188a',
    release: 'v0.8.0',
    releaseRef: 'bdfa7cc260e6cc2333f0812b6e4c8b960ffc188a'
  },
  colibri: {
    head: 'ce370e87d7b623d7759b52ec2007d75fc5b0e87e',
    release: 'v1.12.1',
    releaseRef: 'ce370e87d7b623d7759b52ec2007d75fc5b0e87e'
  }
}

test('reports a fully current native candidate', () => {
  assert.deepEqual(nativeUpstreamChanges(candidate, current), [])
})
test('detects independent head and release changes', () => {
  const changed = structuredClone(current)
  changed.lumabri.head = '1111111111111111111111111111111111111111'
  changed.colibri.release = 'v1.10.0'
  changed.colibri.releaseRef = '2222222222222222222222222222222222222222'

  assert.deepEqual(nativeUpstreamChanges(candidate, changed), [
    {
      component: 'lumabri',
      kind: 'head',
      expected: candidate.lumabri.sourceRef,
      actual: changed.lumabri.head
    },
    {
      component: 'colibri',
      kind: 'release',
      expected: candidate.colibri.release,
      actual: changed.colibri.release
    },
    {
      component: 'colibri',
      kind: 'release-ref',
      expected: candidate.colibri.sourceRef,
      actual: changed.colibri.releaseRef
    }
  ])
})
