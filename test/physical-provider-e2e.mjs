import { createHash } from 'node:crypto'
import { completion, unloadModel } from '@qvac/sdk'
import { createQvacProviderPool, lumabriStatus } from '../client.js'

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive`)
  return value
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function providerPublicKeys() {
  const value = process.env.QVAC_PROVIDER_PUBLIC_KEYS ?? required('QVAC_PROVIDER_PUBLIC_KEY')
  const keys = value.split(',').map((key) => key.trim()).filter(Boolean)
  if (keys.length === 0) throw new Error('at least one QVAC provider public key is required')
  return keys
}

const contractId = process.env.LUMABRI_CONTRACT_ID ?? 'stable-0.1'
const modelFingerprint = required('LUMABRI_MODEL_FINGERPRINT')
const publicKeys = providerPublicKeys()
const transport = {
  type: 'ssh',
  host: required('LUMABRI_SSH_HOST')
}
if (process.env.LUMABRI_SSH_PATH) transport.sshPath = process.env.LUMABRI_SSH_PATH
if (process.env.LUMABRI_SSH_IDENTITY) {
  transport.identityFile = process.env.LUMABRI_SSH_IDENTITY
}
if (process.env.LUMABRI_SSH_KNOWN_HOSTS) {
  transport.knownHostsFile = process.env.LUMABRI_SSH_KNOWN_HOSTS
}

const providerPool = createQvacProviderPool({
  contractId,
  modelFingerprint,
  providers: publicKeys.map((providerPublicKey) => ({
    providerPublicKey,
    contractId,
    modelFingerprint
  }))
})

const prompt = process.env.LUMABRI_PROMPT ?? 'Reply with one short greeting.'
const startedAt = performance.now()
let modelId

try {
  const loaded = await providerPool.loadModel({
    modelSrc: '',
    modelType: 'lumabri-moe',
    modelConfig: {
      gatewayPath: required('LUMABRI_REMOTE_GATEWAY'),
      transport,
      localDir: required('LUMABRI_REMOTE_MODEL'),
      ...(process.env.LUMABRI_REMOTE_ENGINE
        ? { enginePath: process.env.LUMABRI_REMOTE_ENGINE }
        : { enginesDir: required('LUMABRI_REMOTE_ENGINES_DIR') }),
      ctx: positiveInteger('LUMABRI_CTX', 4096),
      maxNew: positiveInteger('LUMABRI_MAX_NEW', 4),
      cap: positiveInteger('LUMABRI_CAP', 12),
      startupTimeoutMs: positiveInteger('LUMABRI_STARTUP_TIMEOUT_MS', 30 * 60 * 1000)
    }
  }, {
    timeout: positiveInteger('QVAC_DELEGATE_TIMEOUT_MS', 45 * 60 * 1000),
    healthCheckTimeout: positiveInteger('QVAC_HEALTH_TIMEOUT_MS', 10_000)
  })
  modelId = loaded.modelId
  const loadedAt = performance.now()
  const status = await lumabriStatus(modelId)
  const run = completion({
    modelId,
    stream: true,
    history: [{ role: 'user', content: prompt }]
  })
  let firstContentAt
  for await (const event of run.events) {
    if (event.type === 'contentDelta' && firstContentAt === undefined) {
      firstContentAt = performance.now()
    }
  }
  const final = await run.final
  const completedAt = performance.now()

  process.stdout.write(`${JSON.stringify({
    result: 'pass',
    contractId,
    modelFingerprint,
    configuredProviders: publicKeys.length,
    selectedProviderIndex: publicKeys.findIndex(
      (publicKey) => publicKey.toLowerCase() === loaded.provider.providerPublicKey
    ),
    gatewayProtocol: status.protocol,
    promptSha256: sha256(prompt),
    outputSha256: sha256(final.contentText),
    outputBytes: Buffer.byteLength(final.contentText),
    loadMs: Math.round(loadedAt - startedAt),
    ttftMs: firstContentAt === undefined ? null : Math.round(firstContentAt - loadedAt),
    totalGenerationMs: Math.round(completedAt - loadedAt),
    generatedTokens: final.stats.generatedTokens,
    tokensPerSecond: final.stats.tokensPerSecond
  }, null, 2)}\n`)
} finally {
  if (modelId) {
    providerPool.forgetModel(modelId)
    await unloadModel({ modelId })
  }
}
