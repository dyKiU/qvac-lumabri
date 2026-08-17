const publicKeyPattern = /^[0-9a-f]{64}$/i

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value
}

function normalizeProvider(provider, index) {
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

function delegateOptions(providerPublicKey, options, defaultHealthCheckTimeout) {
  const healthCheckTimeout = options.healthCheckTimeout ?? defaultHealthCheckTimeout
  const delegate = {
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

function providerIdentity(provider) {
  return {
    providerPublicKey: provider.providerPublicKey,
    contractId: provider.contractId,
    modelFingerprint: provider.modelFingerprint
  }
}

export class QvacProviderPoolError extends Error {
  constructor(message, attempts = []) {
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
  constructor({
    providers,
    contractId,
    modelFingerprint,
    heartbeat,
    loadModel,
    healthCheckTimeout = 3_000
  }) {
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
    this.modelProviders = new Map()

    const publicKeys = new Set()
    for (const provider of this.providers) {
      if (publicKeys.has(provider.providerPublicKey)) {
        throw new TypeError(`duplicate provider public key: ${provider.providerPublicKey}`)
      }
      publicKeys.add(provider.providerPublicKey)
    }
  }

  compatibleProviders() {
    return this.providers.filter((provider) =>
      provider.contractId === this.contractId &&
      provider.modelFingerprint === this.modelFingerprint
    )
  }

  async #probeProviders(healthCheckTimeout) {
    const probes = await Promise.all(this.compatibleProviders().map(async (provider) => {
      try {
        await this.heartbeat({
          delegate: {
            providerPublicKey: provider.providerPublicKey,
            timeout: healthCheckTimeout
          }
        })
        return { provider }
      } catch (error) {
        return { provider, error }
      }
    }))
    return {
      available: probes.filter((probe) => !probe.error).map((probe) => probe.provider),
      failed: probes.filter((probe) => probe.error).map((probe) => ({
        phase: 'heartbeat',
        provider: providerIdentity(probe.provider),
        error: probe.error
      }))
    }
  }

  async availableProviders({ healthCheckTimeout = this.healthCheckTimeout } = {}) {
    return (await this.#probeProviders(healthCheckTimeout)).available
  }

  async loadModel(options, delegate = {}) {
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

  providerForModel(modelId) {
    return this.modelProviders.get(modelId) ?? null
  }

  forgetModel(modelId) {
    return this.modelProviders.delete(modelId)
  }
}
