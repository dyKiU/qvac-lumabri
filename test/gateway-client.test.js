import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn as nodeSpawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
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

function client(overrides = {}, dependencies = { spawn: spawnFake }) {
  return new GatewayClient({
    gatewayPath: 'ignored-lumabri',
    localDir: 'fake-model',
    tracker: '127.0.0.1:7300',
    ctx: 2048,
    maxNew: 64,
    cap: 8,
    startupTimeoutMs: 2000,
    ...overrides
  }, dependencies)
}

function controlledChild(onInput = () => {}) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.signals = []
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      try {
        onInput(String(chunk), child)
        callback()
      } catch (error) {
        callback(error)
      }
    }
  })
  child.kill = (signal) => {
    child.signals.push(signal)
    queueMicrotask(() => child.emit('close', null, signal))
    return true
  }
  return child
}

function writeFragmented(stream, value) {
  const bytes = Buffer.from(value)
  const widths = [1, 3, 2, 5, 4]
  let offset = 0
  let index = 0
  while (offset < bytes.length) {
    const next = Math.min(bytes.length, offset + widths[index++ % widths.length])
    stream.write(bytes.subarray(offset, next))
    offset = next
  }
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

test('preserves subprocess arguments without invoking a shell', async (t) => {
  const captured = {}
  const child = controlledChild()
  const gateway = client({
    gatewayPath: 'lumabri binary',
    localDir: '/models/space 🦜;$(not-a-command)',
    tracker: 'tracker.example:7300',
    enginePath: '/engines/quoted "engine"'
  }, {
    spawn(command, args, options) {
      Object.assign(captured, { command, args, options })
      queueMicrotask(() => child.stdout.write(
        '{"v":1,"type":"ready","protocol":"framed","model":"fake"}\n'
      ))
      return child
    }
  })
  t.after(() => gateway.stop())

  await gateway.start()

  assert.equal(captured.command, 'lumabri binary')
  assert.deepEqual(captured.args, [
    'gateway',
    '--local',
    '/models/space 🦜;$(not-a-command)',
    '--tracker',
    'tracker.example:7300',
    '--engine',
    '/engines/quoted "engine"',
    '--ctx',
    '2048',
    '--max-new',
    '64',
    '--cap',
    '8'
  ])
  assert.deepEqual(captured.options, { stdio: ['pipe', 'pipe', 'pipe'] })
})

test('uses strict SSH options and quotes every remote gateway argument', async (t) => {
  const captured = {}
  const child = controlledChild()
  const gateway = client({
    gatewayPath: "bin/Lumabri's bin/lumabri",
    localDir: "models/space 🦜;$(not-a-command) 'quoted'",
    transport: {
      type: 'ssh',
      host: 'model-host',
      sshPath: 'bin/ssh',
      connectTimeoutSeconds: 7,
      identityFile: 'keys/provider identity',
      knownHostsFile: 'config/known hosts'
    }
  }, {
    spawn(command, args, options) {
      Object.assign(captured, { command, args, options })
      queueMicrotask(() => child.stdout.write(
        '{"v":1,"type":"ready","protocol":"framed","model":"remote"}\n'
      ))
      return child
    }
  })
  t.after(() => gateway.stop())

  await gateway.start()

  assert.equal(captured.command, 'bin/ssh')
  assert.deepEqual(captured.args.slice(0, -2), [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'PermitLocalCommand=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=7',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=2',
    '-o', 'UserKnownHostsFile=config/known hosts',
    '-i', 'keys/provider identity',
    '--'
  ])
  assert.equal(captured.args.at(-2), 'model-host')
  assert.equal(captured.args.at(-1), [
    "exec 'bin/Lumabri'\\''s bin/lumabri'",
    "'gateway'",
    "'--local'",
    "'models/space 🦜;$(not-a-command) '\\''quoted'\\'''",
    "'--tracker'",
    "'127.0.0.1:7300'",
    "'--ctx'",
    "'2048'",
    "'--max-new'",
    "'64'",
    "'--cap'",
    "'8'"
  ].join(' '))
  assert.deepEqual(captured.options, { stdio: ['pipe', 'pipe', 'pipe'] })
})

test('rejects an SSH destination that could be parsed as an option', async () => {
  let spawned = false
  const gateway = client({
    transport: {
      type: 'ssh',
      host: '-oProxyCommand=not-a-command'
    }
  }, {
    spawn() {
      spawned = true
      return controlledChild()
    }
  })

  await assert.rejects(gateway.start(), /SSH host/)
  assert.equal(spawned, false)
})

test('parses NDJSON records fragmented across arbitrary byte boundaries', async (t) => {
  const child = controlledChild((line, activeChild) => {
    const request = JSON.parse(line)
    const reply = Buffer.from('fragmented 🦜 output')
    const split = reply.length - 2
    const records = [
      { v: 1, id: request.id, type: 'delta', data: reply.subarray(0, split).toString('base64') },
      { v: 1, id: request.id, type: 'delta', data: reply.subarray(split).toString('base64') },
      { v: 1, id: request.id, type: 'done', stats: { generatedTokens: 2 } }
    ]
    writeFragmented(activeChild.stdout, records.map((record) => JSON.stringify(record)).join('\n') + '\n')
  })
  const gateway = client({}, {
    spawn() {
      queueMicrotask(() => writeFragmented(
        child.stdout,
        '{"v":1,"type":"ready","protocol":"framed","model":"fake 🦜"}\n'
      ))
      return child
    }
  })
  t.after(() => gateway.stop())

  const ready = await gateway.start()
  const result = await collect(gateway.generate({ requestId: 'fragmented', prompt: 'hello' }))

  assert.equal(ready.model, 'fake 🦜')
  assert.equal(result.bytes.toString(), 'fragmented 🦜 output')
  assert.deepEqual(result.stats, { generatedTokens: 2 })
})

test('kills a gateway that does not become ready before the startup timeout', async () => {
  const child = controlledChild()
  const gateway = client({ startupTimeoutMs: 20 }, { spawn: () => child })

  await assert.rejects(gateway.start(), /was not ready within 20ms/)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(child.signals, ['SIGTERM'])
  assert.equal(gateway.status().running, false)
})

test('surfaces a host-key-style subprocess failure during startup', async () => {
  const child = controlledChild()
  const gateway = client({}, {
    spawn() {
      queueMicrotask(() => {
        child.stderr.write('Host key verification failed.\n')
        child.emit('close', 255, null)
      })
      return child
    }
  })

  await assert.rejects(gateway.start(), /Host key verification failed/)
  assert.equal(gateway.status().running, false)
})

test('cancels a queued request without interrupting the active generation', async (t) => {
  const gateway = client()
  t.after(() => gateway.stop())
  await gateway.start()
  const active = gateway.generate({ requestId: 'active', prompt: 'WAIT' })
  const activeResult = active.next()
  await new Promise((resolve) => setImmediate(resolve))

  const queued = gateway.generate({ requestId: 'queued', prompt: 'later' })
  const queuedResult = queued.next()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(gateway.status(), {
    running: true,
    protocol: 'framed',
    activeRequestId: 'active',
    queued: 1
  })

  assert.equal(gateway.abort('queued'), true)
  assert.equal(gateway.status().running, true)
  await assert.rejects(queuedResult, GatewayCancelledError)
  assert.deepEqual(gateway.status(), {
    running: true,
    protocol: 'framed',
    activeRequestId: 'active',
    queued: 0
  })

  assert.equal(gateway.abort('active'), true)
  await assert.rejects(activeResult, GatewayCancelledError)
})
