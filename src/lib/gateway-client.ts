export const GATEWAY_PROTOCOL_VERSION = 1

export interface LocalGatewayTransport {
  type: 'local'
}

export interface SshGatewayTransport {
  type: 'ssh'
  host: string
  sshPath?: string | undefined
  connectTimeoutSeconds?: number | undefined
  identityFile?: string | undefined
  knownHostsFile?: string | undefined
}

export type GatewayTransport = LocalGatewayTransport | SshGatewayTransport

export interface GatewayConfig {
  gatewayPath: string
  transport?: GatewayTransport | undefined
  localDir?: string | undefined
  model?: string | undefined
  tracker?: string | undefined
  enginePath?: string | undefined
  enginesDir?: string | undefined
  ctx: number
  maxNew: number
  cap: number
  startupTimeoutMs: number
}

export interface GatewayStats {
  elapsedSeconds?: number
  generatedTokens?: number
  tokensPerSecond?: number
  cacheHitPercent?: number
  residentGb?: number
  [key: string]: unknown
}

export interface GatewayReadyRecord {
  v: typeof GATEWAY_PROTOCOL_VERSION
  type: 'ready'
  protocol?: string
  model?: string
}

interface GatewayRecord {
  v: typeof GATEWAY_PROTOCOL_VERSION
  type: string
  id?: unknown
  data?: unknown
  message?: unknown
  stats?: unknown
  protocol?: unknown
  model?: unknown
}

interface GatewayWritable {
  write(data: string): unknown
}

interface GatewayReadable {
  setEncoding(encoding: 'utf8'): unknown
  on(event: 'data', listener: (chunk: string) => void): unknown
}

export interface GatewayChildProcess {
  readonly stdin: GatewayWritable
  readonly stdout: GatewayReadable
  readonly stderr: GatewayReadable
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown
  once(event: 'close', listener: () => void): unknown
  kill(signal?: string | number): unknown
}

export type GatewaySpawn = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe'] }
) => GatewayChildProcess

export class GatewayCancelledError extends Error {
  readonly requestId: string

  constructor(requestId: string, message = 'Lumabri completion cancelled') {
    super(message)
    this.name = 'GatewayCancelledError'
    this.requestId = requestId
  }
}

interface QueueWaiter<T> {
  resolve(value: T): void
  reject(error: unknown): void
}

class RecordQueue<T> {
  private readonly records: T[] = []
  private readonly waiters: QueueWaiter<T>[] = []
  private error: unknown = null

  push(record: T): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(record)
    else this.records.push(record)
  }

  fail(error: unknown): void {
    this.error = error
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  next(): Promise<T> {
    if (this.records.length > 0) return Promise.resolve(this.records.shift()!)
    if (this.error) return Promise.reject(this.error)
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }
}

function gatewayArgs(config: GatewayConfig): string[] {
  const args = ['gateway']
  if (config.localDir) args.push('--local', config.localDir)
  else if (config.model) args.push('--model', config.model)
  else throw new TypeError('gateway config requires localDir or model')
  if (config.tracker) args.push('--tracker', config.tracker)
  if (config.enginePath) args.push('--engine', config.enginePath)
  if (config.enginesDir) args.push('--engines-dir', config.enginesDir)
  args.push('--ctx', String(config.ctx))
  args.push('--max-new', String(config.maxNew))
  args.push('--cap', String(config.cap))
  return args
}

function quoteRemoteArgument(value: unknown): string {
  const argument = String(value)
  if (/[\0\r\n]/.test(argument)) {
    throw new TypeError('SSH remote gateway arguments cannot contain NUL or newlines')
  }
  return `'${argument.replaceAll("'", "'\\''")}'`
}

function gatewayProcess(config: GatewayConfig): { command: string; args: string[] } {
  const args = gatewayArgs(config)
  const transport = config.transport
  if (!transport || transport.type === 'local') {
    return { command: config.gatewayPath, args }
  }
  if ((transport as { type?: unknown }).type !== 'ssh') {
    throw new TypeError(
      `unsupported gateway transport: ${String((transport as { type?: unknown }).type)}`
    )
  }
  const host = transport.host
  if (typeof host !== 'string' || !/^[a-z0-9][a-z0-9._:-]*$/i.test(host)) {
    throw new TypeError('SSH host must be a hostname, address, or configured alias')
  }
  const connectTimeoutSeconds = transport.connectTimeoutSeconds ?? 10
  if (!Number.isSafeInteger(connectTimeoutSeconds) || connectTimeoutSeconds < 1) {
    throw new TypeError('SSH connect timeout must be a positive integer')
  }

  const sshArgs = [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'PermitLocalCommand=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `ConnectTimeout=${connectTimeoutSeconds}`,
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=2'
  ]
  if (transport.knownHostsFile) {
    sshArgs.push('-o', `UserKnownHostsFile=${transport.knownHostsFile}`)
  }
  if (transport.identityFile) sshArgs.push('-i', transport.identityFile)

  const remoteCommand = [config.gatewayPath, ...args]
    .map(quoteRemoteArgument)
    .join(' ')
  return {
    command: transport.sshPath ?? 'ssh',
    args: [...sshArgs, '--', host, `exec ${remoteCommand}`]
  }
}

class GatewayProtocolError extends Error {
  readonly code = 'LUMABRI_PROTOCOL'

  constructor(message: string) {
    super(`Lumabri gateway protocol error: ${message}`)
    this.name = 'GatewayProtocolError'
  }
}

function protocolError(message: string): GatewayProtocolError {
  return new GatewayProtocolError(message)
}

function isGatewayRecord(value: unknown): value is GatewayRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.v === GATEWAY_PROTOCOL_VERSION && typeof record.type === 'string'
}

function gatewayStats(value: unknown): GatewayStats {
  return value && typeof value === 'object' ? value as GatewayStats : {}
}

interface StartWait {
  resolve(record: GatewayReadyRecord): void
  reject(error: unknown): void
}

interface PendingGeneration {
  requestId: string
  wireId: string
  queue: RecordQueue<GatewayRecord>
  cancelled: boolean
}

interface WaitingGeneration {
  requestId: string
  resolve(): void
  reject(error: unknown): void
}

export interface GatewayGenerateRequest {
  requestId: string
  prompt: string
}

export interface GatewayStatus {
  running: boolean
  protocol?: string
  activeRequestId: string | null
  queued: number
}

/** A supervised, serialized client for one `lumabri gateway` child. */
export class GatewayClient {
  private readonly config: GatewayConfig
  private readonly spawn: GatewaySpawn
  private child: GatewayChildProcess | null = null
  private startPromise: Promise<GatewayReadyRecord> | null = null
  private startWait: StartWait | null = null
  private ready: GatewayReadyRecord | null = null
  private stdoutBuffer = ''
  private stderrTail = ''
  private pending: PendingGeneration | null = null
  private activeRequestId: string | null = null
  private readonly waiting: WaitingGeneration[] = []
  private readonly cancelledRequests = new Set<string>()
  private wireSequence = 0

  constructor(config: GatewayConfig, dependencies: { spawn: GatewaySpawn }) {
    if (!dependencies || typeof dependencies.spawn !== 'function') {
      throw new TypeError('GatewayClient requires a subprocess spawn function')
    }
    this.config = config
    this.spawn = dependencies.spawn
  }

  async start(): Promise<GatewayReadyRecord> {
    if (this.child && this.ready) return this.ready
    if (this.startPromise) return this.startPromise
    this.startPromise = this.#spawnAndWait()
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async #spawnAndWait(): Promise<GatewayReadyRecord> {
    const process = gatewayProcess(this.config)
    const child = this.spawn(process.command, process.args, {
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

    return await new Promise<GatewayReadyRecord>((resolve, reject) => {
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

  #onStdout(child: GatewayChildProcess, chunk: string): void {
    if (this.child !== child) return
    this.stdoutBuffer += chunk
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline < 0) break
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, '')
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!line) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        this.#failPending(protocolError(`invalid JSON record ${JSON.stringify(line)}`))
        continue
      }
      if (!isGatewayRecord(parsed)) {
        this.#failPending(protocolError('unsupported or malformed record'))
        continue
      }
      const record = parsed
      if (record.type === 'ready') {
        const ready: GatewayReadyRecord = {
          v: GATEWAY_PROTOCOL_VERSION,
          type: 'ready',
          ...(typeof record.protocol === 'string' ? { protocol: record.protocol } : {}),
          ...(typeof record.model === 'string' ? { model: record.model } : {})
        }
        this.ready = ready
        this.startWait?.resolve(ready)
        continue
      }
      if (!this.pending) continue
      if (record.id !== this.pending.wireId) {
        this.#failPending(protocolError(
          `response id ${String(record.id)} does not match active request`
        ))
        continue
      }
      this.pending.queue.push(record)
    }
  }

  #failPending(error: unknown): void {
    this.pending?.queue.fail(error)
  }

  #onExit(child: GatewayChildProcess, error: Error): void {
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

  #acquire(requestId: string): Promise<void> {
    if (!this.activeRequestId) {
      this.activeRequestId = requestId
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => this.waiting.push({ requestId, resolve, reject }))
  }

  #release(requestId: string): void {
    if (this.activeRequestId !== requestId) return
    const next = this.waiting.shift()
    if (next) {
      this.activeRequestId = next.requestId
      next.resolve()
    } else {
      this.activeRequestId = null
    }
  }

  async *generate(
    { requestId, prompt }: GatewayGenerateRequest
  ): AsyncGenerator<Buffer, GatewayStats, void> {
    await this.#acquire(requestId)
    try {
      if (this.cancelledRequests.has(requestId)) throw new GatewayCancelledError(requestId)
      await this.start()
      if (this.cancelledRequests.has(requestId)) throw new GatewayCancelledError(requestId)
      if (!this.child) throw new Error('lumabri gateway is not running')
      const wireId = String(++this.wireSequence)
      const queue = new RecordQueue<GatewayRecord>()
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
        if (record.type === 'done') return gatewayStats(record.stats)
        if (record.type === 'error') {
          throw new Error(
            typeof record.message === 'string' ? record.message : 'Lumabri gateway failed'
          )
        }
        throw protocolError(`unexpected record type ${record.type}`)
      }
    } finally {
      this.cancelledRequests.delete(requestId)
      if (this.pending?.requestId === requestId) this.pending = null
      this.#release(requestId)
    }
  }

  abort(requestId: string): boolean {
    const queued = this.waiting.findIndex((entry) => entry.requestId === requestId)
    if (queued >= 0) {
      const [entry] = this.waiting.splice(queued, 1)
      entry!.reject(new GatewayCancelledError(requestId))
      return true
    }
    if (this.activeRequestId !== requestId || !this.child) return false
    this.cancelledRequests.add(requestId)
    if (this.pending) this.pending.cancelled = true
    this.child.kill('SIGTERM')
    return true
  }

  async stop(): Promise<void> {
    for (const entry of this.waiting.splice(0)) {
      entry.reject(new GatewayCancelledError(entry.requestId, 'Lumabri model unloaded'))
    }
    const child = this.child
    if (!child) return
    if (this.pending) this.pending.cancelled = true
    await new Promise<void>((resolve) => {
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

  status(): GatewayStatus {
    const status = {
      running: Boolean(this.child && this.ready),
      activeRequestId: this.activeRequestId,
      queued: this.waiting.length
    }
    return this.ready?.protocol ? { ...status, protocol: this.ready.protocol } : status
  }
}

export function completeUtf8PrefixLength(buffer: Uint8Array): number {
  const length = buffer.length
  if (length === 0) return 0
  let lead = length - 1
  while (lead >= 0 && (buffer[lead]! & 0xc0) === 0x80) lead--
  if (lead < 0) return 0
  const byte = buffer[lead]!
  let expected = 1
  if ((byte & 0xe0) === 0xc0) expected = 2
  else if ((byte & 0xf0) === 0xe0) expected = 3
  else if ((byte & 0xf8) === 0xf0) expected = 4
  else return length
  return length - lead < expected ? lead : length
}

export class Utf8ChunkDecoder {
  private carry = Buffer.alloc(0)

  push(chunk: Uint8Array): string {
    const bytes = this.carry.length ? Buffer.concat([this.carry, chunk]) : Buffer.from(chunk)
    const complete = completeUtf8PrefixLength(bytes)
    this.carry = bytes.subarray(complete)
    return bytes.subarray(0, complete).toString('utf8')
  }

  finish(): string {
    const text = this.carry.toString('utf8')
    this.carry = Buffer.alloc(0)
    return text
  }
}
