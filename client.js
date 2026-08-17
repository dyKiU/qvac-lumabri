import { heartbeat, invokePlugin, loadModel } from '@qvac/sdk'
import { QvacProviderPool } from './lib/provider-pool.js'

export { QvacProviderPool, QvacProviderPoolError } from './lib/provider-pool.js'

export function createQvacProviderPool(options) {
  return new QvacProviderPool({
    ...options,
    heartbeat: options.heartbeat ?? heartbeat,
    loadModel: options.loadModel ?? loadModel
  })
}

/**
 * Hard-cancel a Lumabri completion. QVAC 0.17.1 does not expose its worker
 * RequestRegistry to external plugins, so this small plugin RPC is the
 * adapter's cancellation bridge.
 */
export function cancelLumabri(modelId, requestId) {
  return invokePlugin({
    modelId,
    handler: 'lumabriCancel',
    params: { modelId, requestId }
  })
}

export function lumabriStatus(modelId) {
  return invokePlugin({
    modelId,
    handler: 'lumabriStatus',
    params: { modelId }
  })
}
