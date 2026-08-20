import { heartbeat, invokePlugin, loadModel } from '@qvac/sdk'
import {
  QvacProviderPool,
  type QvacHeartbeatOperation,
  type QvacLoadModelOperation,
  type QvacProviderPoolOptions
} from './lib/provider-pool.js'

export {
  QvacProviderPool,
  QvacProviderPoolError,
  type QvacDelegateOptions,
  type QvacHeartbeatOperation,
  type QvacLoadModelOperation,
  type QvacLoadModelOptions,
  type QvacProvider,
  type QvacProviderAttempt,
  type QvacProviderIdentity,
  type QvacProviderPoolOptions
} from './lib/provider-pool.js'

export type CreateQvacProviderPoolOptions = Omit<
  QvacProviderPoolOptions,
  'heartbeat' | 'loadModel'
> & {
  heartbeat?: QvacHeartbeatOperation
  loadModel?: QvacLoadModelOperation
}

export interface CancelLumabriResult {
  cancelled: boolean
}

export interface LumabriStatusResult {
  running: boolean
  protocol?: string
  activeRequestId: string | null
  queued: number
}

export function createQvacProviderPool(options: CreateQvacProviderPoolOptions): QvacProviderPool {
  const loadModelOperation: QvacLoadModelOperation = options.loadModel ??
    (async (loadOptions) => loadModel(loadOptions as never))
  return new QvacProviderPool({
    ...options,
    heartbeat: options.heartbeat ?? heartbeat,
    loadModel: loadModelOperation
  })
}

/**
 * Hard-cancel a locally loaded Lumabri completion. QVAC 0.17.1 does not
 * delegate custom plugin RPC, so delegated models cannot use this bridge.
 */
export function cancelLumabri(modelId: string, requestId: string): Promise<CancelLumabriResult> {
  return invokePlugin<CancelLumabriResult>({
    modelId,
    handler: 'lumabriCancel',
    params: { modelId, requestId }
  })
}

/** Inspect a locally loaded gateway; delegated plugin RPC requires newer QVAC support. */
export function lumabriStatus(modelId: string): Promise<LumabriStatusResult> {
  return invokePlugin<LumabriStatusResult>({
    modelId,
    handler: 'lumabriStatus',
    params: { modelId }
  })
}
