import test from 'node:test'
import assert from 'node:assert/strict'
import { QvacProviderPool, QvacProviderPoolError } from '../dist/lib/provider-pool.js'

const CONTRACT = 'stable-0.1'
const MODEL = 'sha256:model-a'
const key = (digit) => digit.repeat(64)

function provider(digit, overrides = {}) {
  return {
    providerPublicKey: key(digit),
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    ...overrides
  }
}

test('returns only healthy providers matching the required contract and model', async () => {
  const checked = []
  const pool = new QvacProviderPool({
    providers: [
      provider('1'),
      provider('2', { contractId: 'dev-next' }),
      provider('3', { modelFingerprint: 'sha256:model-b' }),
      provider('4')
    ],
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    heartbeat: async ({ delegate }) => {
      checked.push(delegate.providerPublicKey)
      if (delegate.providerPublicKey === key('4')) throw new Error('offline')
    },
    loadModel: async () => assert.fail('loadModel should not be called')
  })

  const available = await pool.availableProviders()

  assert.deepEqual(checked, [key('1'), key('4')])
  assert.deepEqual(available.map((entry) => entry.providerPublicKey), [key('1')])
})

test('retries delegated load on the next healthy provider and records the pin', async () => {
  const attempts = []
  const loadOptions = {
    modelSrc: '',
    modelType: 'lumabri-moe',
    modelConfig: { model: 'model-a', tracker: 'tracker.example:7300' }
  }
  const pool = new QvacProviderPool({
    providers: [provider('a'), provider('b')],
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    heartbeat: async () => {},
    loadModel: async (options) => {
      attempts.push(options)
      if (options.delegate.providerPublicKey === key('a')) throw new Error('provider full')
      return 'delegated-model-a'
    }
  })

  const loaded = await pool.loadModel(loadOptions, {
    timeout: 60_000,
    healthCheckTimeout: 2_000
  })

  assert.equal(loaded.modelId, 'delegated-model-a')
  assert.equal(loaded.provider.providerPublicKey, key('b'))
  assert.equal(pool.providerForModel('delegated-model-a').providerPublicKey, key('b'))
  assert.deepEqual(attempts.map((entry) => entry.delegate), [
    {
      providerPublicKey: key('a'),
      timeout: 60_000,
      healthCheckTimeout: 2_000,
      fallbackToLocal: false
    },
    {
      providerPublicKey: key('b'),
      timeout: 60_000,
      healthCheckTimeout: 2_000,
      fallbackToLocal: false
    }
  ])
  assert.equal('delegate' in loadOptions, false)
})

test('reports every failed provider without silently falling back locally', async () => {
  const pool = new QvacProviderPool({
    providers: [provider('c'), provider('d')],
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    heartbeat: async () => {},
    loadModel: async ({ delegate }) => {
      throw new Error(`load failed on ${delegate.providerPublicKey}`)
    }
  })

  await assert.rejects(
    pool.loadModel({ modelSrc: '', modelType: 'lumabri-moe', modelConfig: {} }),
    (error) => {
      assert(error instanceof QvacProviderPoolError)
      assert.equal(error.attempts.length, 2)
      assert.deepEqual(error.attempts.map((attempt) => attempt.phase), [
        'loadModel',
        'loadModel'
      ])
      assert.match(error.message, /no QVAC provider could load the model/)
      return true
    }
  )
})

test('distinguishes incompatible configuration from provider outage', async () => {
  const pool = new QvacProviderPool({
    providers: [provider('d', { contractId: 'dev-next' })],
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    heartbeat: async () => assert.fail('incompatible providers must not be probed'),
    loadModel: async () => assert.fail('incompatible providers must not be loaded')
  })

  await assert.rejects(
    pool.loadModel({ modelSrc: '', modelType: 'lumabri-moe', modelConfig: {} }),
    /no QVAC providers match contract stable-0\.1 and model sha256:model-a/
  )
})

test('rejects a caller-supplied delegate because the pool owns provider selection', async () => {
  const pool = new QvacProviderPool({
    providers: [provider('e')],
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    heartbeat: async () => {},
    loadModel: async () => assert.fail('loadModel should not be called')
  })

  await assert.rejects(
    pool.loadModel({
      modelSrc: '',
      modelType: 'lumabri-moe',
      modelConfig: {},
      delegate: { providerPublicKey: key('f') }
    }),
    /delegate is managed by QvacProviderPool/
  )
})

test('rejects invalid and case-insensitive duplicate provider public keys', () => {
  const options = {
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    heartbeat: async () => {},
    loadModel: async () => 'unused'
  }

  assert.throws(
    () => new QvacProviderPool({ ...options, providers: [provider('x')] }),
    /must be 64 hexadecimal characters/
  )
  assert.throws(
    () => new QvacProviderPool({ ...options, providers: [provider('a'), provider('A')] }),
    /duplicate provider public key/
  )
})

test('preserves provider priority when concurrent heartbeats resolve out of order', async () => {
  const gates = new Map([key('1'), key('2')].map((publicKey) => {
    let release
    const promise = new Promise((resolve) => { release = resolve })
    return [publicKey, { promise, release }]
  }))
  const pool = new QvacProviderPool({
    providers: [provider('1'), provider('2')],
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    heartbeat: ({ delegate }) => gates.get(delegate.providerPublicKey).promise,
    loadModel: async () => 'unused'
  })

  const pending = pool.availableProviders()
  gates.get(key('2')).release()
  gates.get(key('1')).release()

  const available = await pending
  assert.deepEqual(available.map((entry) => entry.providerPublicKey), [key('1'), key('2')])
})

test('reports heartbeat failures without attempting model loads', async () => {
  let loadAttempts = 0
  const pool = new QvacProviderPool({
    providers: [provider('1'), provider('2')],
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    heartbeat: async ({ delegate }) => {
      throw new Error(`offline: ${delegate.providerPublicKey}`)
    },
    loadModel: async () => {
      loadAttempts++
      return 'unused'
    }
  })

  await assert.rejects(pool.loadModel({ modelSrc: '', modelConfig: {} }), (error) => {
    assert(error instanceof QvacProviderPoolError)
    assert.deepEqual(error.attempts.map((attempt) => attempt.phase), [
      'heartbeat',
      'heartbeat'
    ])
    return true
  })
  assert.equal(loadAttempts, 0)
})

test('propagates explicit connection options to the selected provider', async () => {
  let delegated
  const pool = new QvacProviderPool({
    providers: [provider('a')],
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    heartbeat: async () => {},
    loadModel: async (options) => {
      delegated = options.delegate
      return 'model-a'
    }
  })

  await pool.loadModel({ modelSrc: '', modelConfig: {} }, {
    timeout: 45_000,
    healthCheckTimeout: 1_500,
    forceNewConnection: false
  })

  assert.deepEqual(delegated, {
    providerPublicKey: key('a'),
    timeout: 45_000,
    healthCheckTimeout: 1_500,
    forceNewConnection: false,
    fallbackToLocal: false
  })
})

test('updates and forgets the observed provider when a model id is reused', async () => {
  let activeProvider = key('a')
  const pool = new QvacProviderPool({
    providers: [provider('a'), provider('b')],
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    heartbeat: async ({ delegate }) => {
      if (delegate.providerPublicKey !== activeProvider) throw new Error('offline')
    },
    loadModel: async () => 'shared-model-id'
  })

  await pool.loadModel({ modelSrc: '', modelConfig: {} })
  assert.equal(pool.providerForModel('shared-model-id').providerPublicKey, key('a'))

  activeProvider = key('b')
  await pool.loadModel({ modelSrc: '', modelConfig: {} })
  assert.equal(pool.providerForModel('shared-model-id').providerPublicKey, key('b'))
  assert.equal(pool.forgetModel('shared-model-id'), true)
  assert.equal(pool.providerForModel('shared-model-id'), null)
  assert.equal(pool.forgetModel('shared-model-id'), false)
})

test('keeps provider failure metadata bounded to public contract fields', async () => {
  const secretMarker = 'private-provider-configuration'
  const pool = new QvacProviderPool({
    providers: [provider('a', { operatorSecret: secretMarker, label: 'provider-a' })],
    contractId: CONTRACT,
    modelFingerprint: MODEL,
    heartbeat: async () => {
      throw new Error('offline')
    },
    loadModel: async () => 'unused'
  })

  await assert.rejects(pool.loadModel({ modelSrc: '', modelConfig: {} }), (error) => {
    assert(error instanceof QvacProviderPoolError)
    assert.deepEqual(Object.keys(error.attempts[0].provider).sort(), [
      'contractId',
      'modelFingerprint',
      'providerPublicKey'
    ])
    assert.equal(JSON.stringify(error.attempts).includes(secretMarker), false)
    return true
  })
})
