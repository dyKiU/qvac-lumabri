import { spawn } from 'bare-subprocess'
import { z } from 'zod'
import { defineHandler, definePlugin } from '@qvac/sdk'
import {
  GatewayCancelledError,
  GatewayClient,
  Utf8ChunkDecoder
} from './lib/gateway-client.js'
import { renderHistory } from './lib/prompt.js'

const models = new Map()
let fallbackRequestSequence = 0

const transportSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('local') }).strict(),
  z.object({
    type: z.literal('ssh'),
    host: z.string().regex(/^[a-z0-9][a-z0-9._:-]*$/i),
    sshPath: z.string().min(1).default('ssh'),
    connectTimeoutSeconds: z.number().int().positive().max(120).default(10),
    identityFile: z.string().min(1).optional(),
    knownHostsFile: z.string().min(1).optional()
  }).strict()
])

const loadConfigSchema = z
  .object({
    gatewayPath: z.string().min(1).default('lumabri'),
    transport: transportSchema.default({ type: 'local' }),
    localDir: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    tracker: z.string().min(1).default('127.0.0.1:7300'),
    enginePath: z.string().min(1).optional(),
    enginesDir: z.string().min(1).optional(),
    ctx: z.number().int().positive().default(2048),
    maxNew: z.number().int().positive().default(256),
    cap: z.number().int().positive().default(64),
    startupTimeoutMs: z.number().int().positive().default(10 * 60 * 1000),
    historyMode: z.enum(['full', 'last-user']).default('full'),
    maxPromptBytes: z.number().int().positive().max(1024 * 1024).default(1024 * 1024)
  })
  .strict()
  .superRefine((config, ctx) => {
    if (Boolean(config.localDir) === Boolean(config.model)) {
      ctx.addIssue({
        code: 'custom',
        message: 'choose exactly one of localDir or model'
      })
    }
  })

const historyMessageSchema = z
  .object({
    role: z.string(),
    content: z.string(),
    attachments: z.array(z.unknown()).optional()
  })
  .passthrough()

const completionRequestSchema = z
  .object({
    type: z.literal('completionStream'),
    modelId: z.string(),
    history: z.array(historyMessageSchema),
    stream: z.boolean(),
    requestId: z.string().min(1).optional(),
    tools: z.array(z.unknown()).optional(),
    responseFormat: z.unknown().optional(),
    captureThinking: z.boolean().optional(),
    emitRawDeltas: z.boolean().optional(),
    generationParams: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough()

const completionResponseSchema = z
  .object({
    type: z.literal('completionStream'),
    done: z.boolean().optional(),
    events: z.array(z.unknown())
  })
  .strict()

const modelRequestSchema = z.object({ modelId: z.string() }).strict()
const cancelRequestSchema = modelRequestSchema.extend({ requestId: z.string().min(1) }).strict()
const cancelResponseSchema = z.object({ cancelled: z.boolean() }).strict()
const statusResponseSchema = z
  .object({
    running: z.boolean(),
    protocol: z.string().optional(),
    activeRequestId: z.string().nullable(),
    queued: z.number().int().nonnegative()
  })
  .strict()

function getModel(modelId) {
  const model = models.get(modelId)
  if (!model) throw new Error(`Lumabri model is not loaded: ${modelId}`)
  return model
}

function validateCompletionFeatures(request) {
  if (request.tools?.length) {
    throw new Error('Lumabri adapter 0.1 does not support QVAC tool calling')
  }
  if (request.responseFormat && request.responseFormat.type !== 'text') {
    throw new Error('Lumabri adapter 0.1 supports text responseFormat only')
  }
  for (const message of request.history) {
    if (message.attachments?.length) {
      throw new Error('Lumabri adapter 0.1 does not support attachments')
    }
  }
}

function selectStats(stats) {
  const result = {}
  if (Number.isFinite(stats?.generatedTokens)) result.generatedTokens = stats.generatedTokens
  if (Number.isFinite(stats?.tokensPerSecond)) result.tokensPerSecond = stats.tokensPerSecond
  return result
}

class LumabriModel {
  constructor(modelId, config) {
    this.modelId = modelId
    this.config = config
    this.gateway = new GatewayClient(config, { spawn })
  }

  async load() {
    await this.gateway.start()
    models.set(this.modelId, this)
  }

  async unload() {
    models.delete(this.modelId)
    await this.gateway.stop()
  }
}

const lumabriPlugin = definePlugin({
  modelType: 'lumabri-moe',
  displayName: 'Lumabri distributed MoE',
  addonPackage: '@lumabri/qvac-adapter',
  skipPrimaryModelPathValidation: true,
  loadConfigSchema,

  createModel(params) {
    return { model: new LumabriModel(params.modelId, params.modelConfig) }
  },

  handlers: {
    completionStream: defineHandler({
      requestSchema: completionRequestSchema,
      responseSchema: completionResponseSchema,
      streaming: true,
      // External plugins cannot join QVAC's private RequestRegistry in 0.17.1.
      // The exported cancelLumabri() bridge below performs a real hard cancel.
      cancel: { scope: 'none' },

      async *handler(request) {
        validateCompletionFeatures(request)
        const model = getModel(request.modelId)
        const requestId = request.requestId ?? `lumabri-${++fallbackRequestSequence}`
        const prompt = renderHistory(request.history, model.config)
        const decoder = new Utf8ChunkDecoder()
        const run = model.gateway.generate({ requestId, prompt })
        const buffered = []
        let sequence = 0
        let fullText = ''

        const send = (events) => {
          if (request.stream) return { type: 'completionStream', events }
          buffered.push(...events)
          return null
        }

        try {
          let result = await run.next()
          while (!result.done) {
            const text = decoder.push(result.value)
            if (text) {
              fullText += text
              const events = [{ type: 'contentDelta', seq: sequence++, text }]
              if (request.emitRawDeltas) {
                events.push({ type: 'rawDelta', seq: sequence++, text })
              }
              const frame = send(events)
              if (frame) yield frame
            }
            result = await run.next()
          }

          const tail = decoder.finish()
          if (tail) {
            fullText += tail
            const events = [{ type: 'contentDelta', seq: sequence++, text: tail }]
            if (request.emitRawDeltas) {
              events.push({ type: 'rawDelta', seq: sequence++, text: tail })
            }
            const frame = send(events)
            if (frame) yield frame
          }

          const stats = selectStats(result.value)
          const terminal = []
          if (Object.keys(stats).length) {
            terminal.push({ type: 'completionStats', seq: sequence++, stats })
          }
          terminal.push({
            type: 'completionDone',
            seq: sequence++,
            stopReason: 'eos',
            raw: { fullText }
          })
          if (!request.stream) buffered.push(...terminal)
          yield {
            type: 'completionStream',
            done: true,
            events: request.stream ? terminal : buffered
          }
        } catch (error) {
          const cancelled = error instanceof GatewayCancelledError
          const terminal = {
            type: 'completionDone',
            seq: sequence++,
            ...(cancelled
              ? { stopReason: 'cancelled' }
              : {
                  stopReason: 'error',
                  error: { message: error instanceof Error ? error.message : String(error) }
                }),
            raw: { fullText }
          }
          if (!request.stream) buffered.push(terminal)
          yield {
            type: 'completionStream',
            done: true,
            events: request.stream ? [terminal] : buffered
          }
        } finally {
          await run.return?.()
        }
      }
    }),

    lumabriCancel: defineHandler({
      requestSchema: cancelRequestSchema,
      responseSchema: cancelResponseSchema,
      streaming: false,
      cancel: { scope: 'none' },
      async handler(request) {
        return { cancelled: getModel(request.modelId).gateway.abort(request.requestId) }
      }
    }),

    lumabriStatus: defineHandler({
      requestSchema: modelRequestSchema,
      responseSchema: statusResponseSchema,
      streaming: false,
      cancel: { scope: 'none' },
      async handler(request) {
        return getModel(request.modelId).gateway.status()
      }
    })
  }
})

export default lumabriPlugin
