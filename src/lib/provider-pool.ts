const publicKeyPattern = /^[0-9a-f]{64}$/i

export interface QvacProvider {
  providerPublicKey: string
  contractId: string
  modelFingerprint: string
  [key: string]: unknown
}

export interface QvacProviderIdentity {
  providerPublicKey: string
  contractId: string
  modelFingerprint: string
}

export interface QvacProviderAttempt {
  phase: 'heartbeat' | 'loadModel'
  provider: QvacProviderIdentity
  error: unknown
}

export interface QvacDelegateOptions {
  healthCheckTimeout?: number
  timeout?: number
  forceNewConnection?: boolean
}

export interface QvacLoadDelegate {
  providerPublicKey: string
  healthCheckTimeout: number
  fallbackToLocal: false
  timeout?: number
  forceNewConnection?: boolean
}

export type QvacHeartbeatOperation = (params: {
  delegate: { providerPublicKey: string; timeout: number }
}) => Promise<unknown>

export type QvacLoadModelOptions = Record<string, unknown>

export type QvacLoadModelOperation = (
  options: QvacLoadModelOptions & { delegate: QvacLoadDelegate }
) => Promise<string>

export interface QvacProviderPoolOptions {
  providers: readonly QvacProvider[]
  contractId: string
  modelFingerprint: string
  heartbeat: QvacHeartbeatOperation
  loadModel: QvacLoadModelOperation
  healthCheckTimeout?: number
}

interface ProviderProbeResult {
  available: readonly Readonly<QvacProvider>[]
  failed: QvacProviderAttempt[]
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value
}

function normalizeProvider(provider: QvacProvider, index: number): Readonly<QvacProvider> {
  if (!provider || typeof provider !== 'object') {
    throw new TypeError(`providers[${index}] must be an object`)
  }
  const providerPublicKey = requireString(
    provider.providerPublicKey,
    `providers[${index}].providerPublicKey`
  ).toLowerCase()
  if (!publicKeyPattern.test(providerPublicKey)) {
    throw new TypeError(`providers[${index}].providerPublicKey must be 64 hexadecimal characters`)
  }
  return Object.freeze({
    ...provider,
    providerPublicKey,
    contractId: requireString(provider.contractId, `providers[${index}].contractId`),
    modelFingerprint: requireString(
      provider.modelFingerprint,
      `providers[${index}].modelFingerprint`
    )
  })
}

function delegateOptions(
  providerPublicKey: string,
  options: QvacDelegateOptions,
  defaultHealthCheckTimeout: number
): QvacLoadDelegate {
  const healthCheckTimeout = options.healthCheckTimeout ?? defaultHealthCheckTimeout
  const delegate: QvacLoadDelegate = {
    providerPublicKey,
    healthCheckTimeout,
    fallbackToLocal: false
  }
  if (options.timeout !== undefined) delegate.timeout = options.timeout
  if (options.forceNewConnection !== undefined) {
    delegate.forceNewConnection = options.forceNewConnection
  }
  return delegate
}

function providerIdentity(provider: QvacProvider): QvacProviderIdentity {
  return {
    providerPublicKey: provider.providerPublicKey,
    contractId: provider.contractId,
    modelFingerprint: provider.modelFingerprint
  }
}

export class QvacProviderPoolError extends Error {
  readonly attempts: QvacProviderAttempt[]

  constructor(message: string, attempts: QvacProviderAttempt[] = []) {
    super(message)
    this.name = 'QvacProviderPoolError'
    this.attempts = attempts
  }
}

/**
 * Selects a compatible QVAC coordinator and retries delegated model loading.
 * Provider order is the default priority; QVAC pins later completions itself.
 */
export class QvacProviderPool {
  readonly contractId: string
  readonly modelFingerprint: string
  readonly heartbeat: QvacHeartbeatOperation
  readonly loadModelOperation: QvacLoadModelOperation
  readonly healthCheckTimeout: number
  readonly providers: readonly Readonly<QvacProvider>[]
  readonly modelProviders = new Map<string, Readonly<QvacProvider>>()

  constructor({
    providers,
    contractId,
    modelFingerprint,
    heartbeat,
    loadModel,
    healthCheckTimeout = 3_000
  }: QvacProviderPoolOptions) {
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new TypeError('providers must be a non-empty array')
    }
    if (typeof heartbeat !== 'function' || typeof loadModel !== 'function') {
      throw new TypeError('heartbeat and loadModel operations are required')
    }
    if (!Number.isFinite(healthCheckTimeout) || healthCheckTimeout < 100) {
      throw new TypeError('healthCheckTimeout must be at least 100 milliseconds')
    }

    this.contractId = requireString(contractId, 'contractId')
    this.modelFingerprint = requireString(modelFingerprint, 'modelFingerprint')
    this.heartbeat = heartbeat
    this.loadModelOperation = loadModel
    this.healthCheckTimeout = healthCheckTimeout
    this.providers = providers.map(normalizeProvider)
    const publicKeys = new Set<string>()
    for (const provider of this.providers) {
      if (publicKeys.has(provider.providerPublicKey)) {
        throw new TypeError(`duplicate provider public key: ${provider.providerPublicKey}`)
      }
      publicKeys.add(provider.providerPublicKey)
    }
  }

  compatibleProviders(): readonly Readonly<QvacProvider>[] {
    return this.providers.filter((provider) =>
      provider.contractId === this.contractId &&
      provider.modelFingerprint === this.modelFingerprint
    )
  }

  async #probeProviders(healthCheckTimeout: number): Promise<ProviderProbeResult> {
    const probes = await Promise.all(this.compatibleProviders().map(async (provider) => {
      try {
        await this.heartbeat({
          delegate: {
            providerPublicKey: provider.providerPublicKey,
            timeout: healthCheckTimeout
          }
        })
        return { ok: true as const, provider }
      } catch (error) {
        return { ok: false as const, provider, error }
      }
    }))
    const available: Readonly<QvacProvider>[] = []
    const failed: QvacProviderAttempt[] = []
    for (const probe of probes) {
      if (probe.ok) available.push(probe.provider)
      else failed.push({
        phase: 'heartbeat',
        provider: providerIdentity(probe.provider),
        error: probe.error
      })
    }
    return { available, failed }
  }

  async availableProviders(
    { healthCheckTimeout = this.healthCheckTimeout }: { healthCheckTimeout?: number } = {}
  ): Promise<readonly Readonly<QvacProvider>[]> {
    return (await this.#probeProviders(healthCheckTimeout)).available
  }

  async loadModel(
    options: QvacLoadModelOptions,
    delegate: QvacDelegateOptions = {}
  ): Promise<{ modelId: string; provider: Readonly<QvacProvider> }> {
    if (!options || typeof options !== 'object') {
      throw new TypeError('loadModel options are required')
    }
    if ('delegate' in options) {
      throw new TypeError('delegate is managed by QvacProviderPool')
    }

    if (this.compatibleProviders().length === 0) {
      throw new QvacProviderPoolError(
        `no QVAC providers match contract ${this.contractId} and model ${this.modelFingerprint}`
      )
    }

    const healthCheckTimeout = delegate.healthCheckTimeout ?? this.healthCheckTimeout
    const probe = await this.#probeProviders(healthCheckTimeout)
    const attempts = [...probe.failed]

    for (const provider of probe.available) {
      try {
        const modelId = await this.loadModelOperation({
          ...options,
          delegate: delegateOptions(provider.providerPublicKey, delegate, this.healthCheckTimeout)
        })
        this.modelProviders.set(modelId, provider)
        return { modelId, provider }
      } catch (error) {
        attempts.push({ phase: 'loadModel', provider: providerIdentity(provider), error })
      }
    }

    throw new QvacProviderPoolError('no QVAC provider could load the model', attempts)
  }

  providerForModel(modelId: string): Readonly<QvacProvider> | null {
    return this.modelProviders.get(modelId) ?? null
  }

  forgetModel(modelId: string): boolean {
    return this.modelProviders.delete(modelId)
  }
}
