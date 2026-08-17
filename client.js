import { invokePlugin } from '@qvac/sdk'

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
