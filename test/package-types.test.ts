import {
  createQvacProviderPool,
  type QvacProvider
} from '@lumabri/qvac-adapter'
import {
  GATEWAY_PROTOCOL_VERSION,
  GatewayClient,
  type GatewayConfig,
  type GatewaySpawn
} from '@lumabri/qvac-adapter/gateway-client'
import lumabriPlugin from '@lumabri/qvac-adapter/plugin'
import { renderHistory } from '@lumabri/qvac-adapter/prompt'

const provider: QvacProvider = {
  providerPublicKey: 'a'.repeat(64),
  contractId: 'stable-0.1',
  modelFingerprint: 'test-model'
}

const pool = createQvacProviderPool({
  providers: [provider],
  contractId: provider.contractId,
  modelFingerprint: provider.modelFingerprint,
  heartbeat: async () => ({}),
  loadModel: async () => 'model-id'
})

const config: GatewayConfig = {
  gatewayPath: 'lumabri',
  localDir: 'model',
  ctx: 128,
  maxNew: 8,
  cap: 2,
  startupTimeoutMs: 1_000
}
const spawn: GatewaySpawn = () => { throw new Error('type-only fixture') }
const gateway = new GatewayClient(config, { spawn })

void pool
void gateway
void GATEWAY_PROTOCOL_VERSION
void lumabriPlugin.modelType
void renderHistory([{ role: 'user', content: 'hello' }])
