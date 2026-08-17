export const GATEWAY_PROTOCOL_VERSION = 1

export class GatewayCancelledError extends Error {
  constructor(requestId, message = 'Lumabri completion cancelled') {
    super(message)
    this.name = 'GatewayCancelledError'
    this.requestId = requestId
  }
}

class RecordQueue {
  constructor() {
    this.records = []
    this.waiters = []
    this.error = null
  }

  push(record) {
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(record)
    else this.records.push(record)
  }

  fail(error) {
    this.error = error
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  next() {
    if (this.records.length > 0) return Promise.resolve(this.records.shift())
    if (this.error) return Promise.reject(this.error)
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }
}

function gatewayArgs(config) {
  const args = ['gateway']
  if (config.localDir) args.push('--local', config.localDir)
  else args.push('--model', config.model)
  if (config.tracker) args.push('--tracker', config.tracker)
  if (config.enginePath) args.push('--engine', config.enginePath)
  if (config.enginesDir) args.push('--engines-dir', config.enginesDir)
  args.push('--ctx', String(config.ctx))
  args.push('--max-new', String(config.maxNew))
  args.push('--cap', String(config.cap))
  return args
}

function protocolError(message) {
  const error = new Error(`Lumabri gateway protocol error: ${message}`)
  error.code = 'LUMABRI_PROTOCOL'
  return error
}

/** A supervised, serialized client for one `lumabri gateway` child. */
export class GatewayClient {
  constructor(config, dependencies) {
    if (!dependencies || typeof dependencies.spawn !== 'function') {
      throw new TypeError('GatewayClient requires a subprocess spawn function')
    }
    this.config = config
    this.spawn = dependencies.spawn
    this.child = null
    this.startPromise = null
    this.startWait = null
    this.ready = null
    this.stdoutBuffer = ''
    this.stderrTail = ''
    this.pending = null
    this.activeRequestId = null
    this.waiting = []
    this.cancelledRequests = new Set()
    this.wireSequence = 0
    this.stopping = false
  }

  async start() {
    if (this.child && this.ready) return this.ready
    if (this.startPromise) return this.startPromise
    this.stopping = false
    this.startPromise = this.#spawnAndWait()
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async #spawnAndWait() {
    const child = this.spawn(this.config.gatewayPath, gatewayArgs(this.config), {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    this.ready = null
    this.stdoutBuffer = ''
    this.stderrTail = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.#onStdout(child, chunk))
    child.stderr.on('data', (chunk) => {
      if (this.child !== child) return
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-65536)
    })
    child.on('error', (error) => this.#onExit(child, error))
    child.on('close', (code, signal) => {
      const suffix = this.stderrTail.trim()
      const detail = suffix ? `; stderr: ${suffix}` : ''
      this.#onExit(
        child,
        new Error(`lumabri gateway exited (code=${code}, signal=${signal ?? 'none'})${detail}`)
      )
    })

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.child === child) child.kill('SIGTERM')
        reject(new Error(`lumabri gateway was not ready within ${this.config.startupTimeoutMs}ms`))
      }, this.config.startupTimeoutMs)
      this.startWait = {
        resolve: (record) => {
          clearTimeout(timeout)
          this.startWait = null
          resolve(record)
        },
        reject: (error) => {
          clearTimeout(timeout)
          this.startWait = null
          reject(error)
        }
      }
    })
  }

  #onStdout(child, chunk) {
    if (this.child !== child) return
    this.stdoutBuffer += chunk
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline < 0) break
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, '')
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!line) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        this.#failPending(protocolError(`invalid JSON record ${JSON.stringify(line)}`))
        continue
      }
      if (record?.v !== GATEWAY_PROTOCOL_VERSION || typeof record.type !== 'string') {
        this.#failPending(protocolError('unsupported or malformed record'))
        continue
      }
      if (record.type === 'ready') {
        this.ready = record
        this.startWait?.resolve(record)
        continue
      }
      if (!this.pending) continue
      if (record.id !== this.pending.wireId) {
        this.#failPending(protocolError(`response id ${record.id} does not match active request`))
        continue
      }
      this.pending.queue.push(record)
    }
  }

  #failPending(error) {
    this.pending?.queue.fail(error)
  }

  #onExit(child, error) {
    if (this.child !== child) return
    this.child = null
    this.ready = null
    this.startWait?.reject(error)
    const requestId = this.activeRequestId
    const failure = requestId && (this.pending?.cancelled || this.cancelledRequests.has(requestId))
      ? new GatewayCancelledError(requestId)
      : error
    this.#failPending(failure)
  }

  #acquire(requestId) {
    if (!this.activeRequestId) {
      this.activeRequestId = requestId
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => this.waiting.push({ requestId, resolve, reject }))
  }

  #release(requestId) {
    if (this.activeRequestId !== requestId) return
    const next = this.waiting.shift()
    if (next) {
      this.activeRequestId = next.requestId
      next.resolve()
    } else {
      this.activeRequestId = null
    }
  }

  async *generate({ requestId, prompt }) {
    await this.#acquire(requestId)
    try {
      if (this.cancelledRequests.has(requestId)) throw new GatewayCancelledError(requestId)
      await this.start()
      if (this.cancelledRequests.has(requestId)) throw new GatewayCancelledError(requestId)
      if (!this.child) throw new Error('lumabri gateway is not running')
      const wireId = String(++this.wireSequence)
      const queue = new RecordQueue()
      this.pending = { requestId, wireId, queue, cancelled: false }
      const envelope = {
        v: GATEWAY_PROTOCOL_VERSION,
        id: wireId,
        op: 'generate',
        prompt: Buffer.from(prompt, 'utf8').toString('base64')
      }
      this.child.stdin.write(`${JSON.stringify(envelope)}\n`)

      for (;;) {
        const record = await queue.next()
        if (record.type === 'delta') {
          if (typeof record.data !== 'string') throw protocolError('delta has no base64 data')
          yield Buffer.from(record.data, 'base64')
          continue
        }
        if (record.type === 'done') return record.stats ?? {}
        if (record.type === 'error') throw new Error(record.message ?? 'Lumabri gateway failed')
        throw protocolError(`unexpected record type ${record.type}`)
      }
    } finally {
      this.cancelledRequests.delete(requestId)
      if (this.pending?.requestId === requestId) this.pending = null
      this.#release(requestId)
    }
  }

  abort(requestId) {
    const queued = this.waiting.findIndex((entry) => entry.requestId === requestId)
    if (queued >= 0) {
      const [entry] = this.waiting.splice(queued, 1)
      entry.reject(new GatewayCancelledError(requestId))
      return true
    }
    if (this.activeRequestId !== requestId || !this.child) return false
    this.cancelledRequests.add(requestId)
    if (this.pending) this.pending.cancelled = true
    this.child.kill('SIGTERM')
    return true
  }

  async stop() {
    this.stopping = true
    for (const entry of this.waiting.splice(0)) {
      entry.reject(new GatewayCancelledError(entry.requestId, 'Lumabri model unloaded'))
    }
    const child = this.child
    if (!child) return
    if (this.pending) this.pending.cancelled = true
    await new Promise((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        done()
      }, 3000)
      child.once('close', done)
      child.kill('SIGTERM')
    })
  }

  status() {
    return {
      running: Boolean(this.child && this.ready),
      protocol: this.ready?.protocol,
      activeRequestId: this.activeRequestId,
      queued: this.waiting.length
    }
  }
}

export function completeUtf8PrefixLength(buffer) {
  const length = buffer.length
  if (length === 0) return 0
  let lead = length - 1
  while (lead >= 0 && (buffer[lead] & 0xc0) === 0x80) lead--
  if (lead < 0) return 0
  const byte = buffer[lead]
  let expected = 1
  if ((byte & 0xe0) === 0xc0) expected = 2
  else if ((byte & 0xf0) === 0xe0) expected = 3
  else if ((byte & 0xf8) === 0xf0) expected = 4
  else return length
  return length - lead < expected ? lead : length
}

export class Utf8ChunkDecoder {
  constructor() {
    this.carry = Buffer.alloc(0)
  }

  push(chunk) {
    const bytes = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk
    const complete = completeUtf8PrefixLength(bytes)
    this.carry = bytes.subarray(complete)
    return bytes.subarray(0, complete).toString('utf8')
  }

  finish() {
    const text = this.carry.toString('utf8')
    this.carry = Buffer.alloc(0)
    return text
  }
}
