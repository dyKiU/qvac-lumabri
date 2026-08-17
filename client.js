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
 * Hard-cancel a locally loaded Lumabri completion. QVAC 0.17.1 does not
 * delegate custom plugin RPC, so delegated models cannot use this bridge.
 */
export function cancelLumabri(modelId, requestId) {
  return invokePlugin({
    modelId,
    handler: 'lumabriCancel',
    params: { modelId, requestId }
  })
}

/** Inspect a locally loaded gateway; delegated plugin RPC requires newer QVAC support. */
export function lumabriStatus(modelId) {
  return invokePlugin({
    modelId,
    handler: 'lumabriStatus',
    params: { modelId }
  })
}
