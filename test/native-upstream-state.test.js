import assert from 'node:assert/strict'
import test from 'node:test'

import { nativeUpstreamChanges } from '../scripts/check-native-upstreams.mjs'

const candidate = {
  lumabri: {
    releaseBase: 'v0.8.0',
    sourceRef: '07847c6e2b1be12d93e11098fc26cc1a8e03e247'
  },
  colibri: {
    release: 'v1.9.0',
    sourceRef: '184e05221a43b3bbeb3321e3438c067b3a46e202'
  }
}

const current = {
  lumabri: {
    head: '07847c6e2b1be12d93e11098fc26cc1a8e03e247',
    release: 'v0.8.0'
  },
  colibri: {
    head: '184e05221a43b3bbeb3321e3438c067b3a46e202',
    release: 'v1.9.0',
    releaseRef: '184e05221a43b3bbeb3321e3438c067b3a46e202'
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
