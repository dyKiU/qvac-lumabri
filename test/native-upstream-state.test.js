import assert from 'node:assert/strict'
import test from 'node:test'

import { nativeUpstreamChanges } from '../scripts/check-native-upstreams.mjs'

const candidate = {
  lumabri: {
    releaseBase: 'v0.8.0',
    sourceRef: 'bdfa7cc260e6cc2333f0812b6e4c8b960ffc188a'
  },
  colibri: {
    release: 'v1.12.0',
    sourceRef: 'dcd73832f293750086643e1f0ccd2cd6d067259c',
    headRef: '9d5d05de7f4ccf39840224ed295f292ab8aeb598'
  }
}

const current = {
  lumabri: {
    head: 'bdfa7cc260e6cc2333f0812b6e4c8b960ffc188a',
    release: 'v0.8.0'
  },
  colibri: {
    head: '9d5d05de7f4ccf39840224ed295f292ab8aeb598',
    release: 'v1.12.0',
    releaseRef: 'dcd73832f293750086643e1f0ccd2cd6d067259c'
  }
}

test('reports a fully current native candidate', () => {
  assert.deepEqual(nativeUpstreamChanges(candidate, current), [])
})
test('detects independent head and release changes', () => {
  const changed = structuredClone(current)
  changed.lumabri.head = '1111111111111111111111111111111111111111'
  changed.colibri.head = '3333333333333333333333333333333333333333'
  changed.colibri.release = 'v1.11.0'
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
      kind: 'head',
      expected: candidate.colibri.headRef,
      actual: changed.colibri.head
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
