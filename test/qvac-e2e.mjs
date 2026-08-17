import assert from 'node:assert/strict'
import { chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { completion, loadModel, unloadModel } from '@qvac/sdk'

const gatewayPath = fileURLToPath(new URL('./fake-gateway.mjs', import.meta.url))
await chmod(gatewayPath, 0o755)

const modelId = await loadModel({
  modelSrc: '',
  modelType: 'lumabri-moe',
  modelConfig: {
    gatewayPath,
    localDir: 'fake-model',
    ctx: 128,
    maxNew: 8,
    cap: 2,
    startupTimeoutMs: 10000
  }
})

try {
  const run = completion({
    modelId,
    stream: true,
    history: [{ role: 'user', content: 'hello' }]
  })
  const events = []
  for await (const event of run.events) events.push(event)
  const final = await run.final

  assert(events.some((event) => event.type === 'contentDelta'))
  assert(events.some((event) => event.type === 'completionStats'))
  assert.equal(final.contentText, 'reply(User: hello || Assistant:) 🦜')
  assert.equal(final.stats.generatedTokens, 3)
  process.stdout.write('QVAC adapter end-to-end: PASS\n')
} finally {
  await unloadModel({ modelId })
}
