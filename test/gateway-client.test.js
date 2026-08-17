import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn as nodeSpawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  GatewayCancelledError,
  GatewayClient,
  Utf8ChunkDecoder
} from '../lib/gateway-client.js'

const fakeGateway = fileURLToPath(new URL('./fake-gateway.mjs', import.meta.url))

function spawnFake(_command, args, options) {
  return nodeSpawn(process.execPath, [fakeGateway, ...args], options)
}

function client() {
  return new GatewayClient({
    gatewayPath: 'ignored-lumabri',
    localDir: 'fake-model',
    tracker: '127.0.0.1:7300',
    ctx: 2048,
    maxNew: 64,
    cap: 8,
    startupTimeoutMs: 2000
  }, { spawn: spawnFake })
}

async function collect(run) {
  const chunks = []
  let result = await run.next()
  while (!result.done) {
    chunks.push(result.value)
    result = await run.next()
  }
  return { bytes: Buffer.concat(chunks), stats: result.value }
}

test('supervises gateway and returns binary-safe streamed output', async (t) => {
  const gateway = client()
  t.after(() => gateway.stop())
  const ready = await gateway.start()
  assert.equal(ready.protocol, 'framed')

  const result = await collect(gateway.generate({ requestId: 'r1', prompt: 'hello' }))
  assert.equal(result.bytes.toString('utf8'), 'reply(hello) 🦜')
  assert.deepEqual(result.stats, { generatedTokens: 3, tokensPerSecond: 12.5 })
  assert.deepEqual(gateway.status(), {
    running: true,
    protocol: 'framed',
    activeRequestId: null,
    queued: 0
  })
})

test('incremental decoder preserves a code point split across deltas', () => {
  const bytes = Buffer.from('A🦜B')
  const decoder = new Utf8ChunkDecoder()
  const first = decoder.push(bytes.subarray(0, 3))
  const second = decoder.push(bytes.subarray(3))
  assert.equal(first + second + decoder.finish(), 'A🦜B')
})

test('hard cancellation kills the process and the next request restarts it', async (t) => {
  const gateway = client()
  t.after(() => gateway.stop())
  await gateway.start()

  const stalled = gateway.generate({ requestId: 'cancel-me', prompt: 'WAIT' })
  const waiting = stalled.next()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(gateway.abort('cancel-me'), true)
  await assert.rejects(waiting, GatewayCancelledError)

  const result = await collect(gateway.generate({ requestId: 'after', prompt: 'again' }))
  assert.equal(result.bytes.toString('utf8'), 'reply(again) 🦜')
})

test('same-model completions queue in FIFO order', async (t) => {
  const gateway = client()
  t.after(() => gateway.stop())
  const first = collect(gateway.generate({ requestId: 'first', prompt: 'one' }))
  const second = collect(gateway.generate({ requestId: 'second', prompt: 'two' }))
  const [a, b] = await Promise.all([first, second])
  assert.equal(a.bytes.toString(), 'reply(one) 🦜')
  assert.equal(b.bytes.toString(), 'reply(two) 🦜')
})
