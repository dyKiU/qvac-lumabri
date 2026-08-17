import assert from 'node:assert/strict'
import { chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { completion, loadModel, unloadModel } from '@qvac/sdk'

const sshPath = fileURLToPath(new URL('./fake-ssh.mjs', import.meta.url))
await chmod(sshPath, 0o755)

const modelId = await loadModel({
  modelSrc: '',
  modelType: 'lumabri-moe',
  modelConfig: {
    gatewayPath: 'remote-lumabri',
    transport: {
      type: 'ssh',
      host: 'model-host',
      sshPath
    },
    localDir: 'remote-model',
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
    history: [{ role: 'user', content: 'hello over SSH' }]
  })
  for await (const _event of run.events) {
    // Consuming the event stream is required before awaiting the final value.
  }
  const final = await run.final

  assert.equal(final.contentText, 'reply(User: hello over SSH || Assistant:) 🦜')
  assert.equal(final.stats.generatedTokens, 3)
  process.stdout.write('QVAC SSH transport end-to-end: PASS\n')
} finally {
  await unloadModel({ modelId })
}
