import { startQVACProvider, stopQVACProvider } from '@qvac/sdk'

let stopping = false

async function stop(signal) {
  if (stopping) return
  stopping = true
  try {
    await stopQVACProvider()
  } catch (error) {
    process.stderr.write(`stop provider: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  process.stderr.write(`provider stopped (${signal})\n`)
  process.exit(0)
}

try {
  const provider = await startQVACProvider()
  process.stdout.write(`${JSON.stringify({
    type: 'ready',
    providerPublicKey: provider.publicKey
  })}\n`)
  process.on('SIGINT', () => void stop('SIGINT'))
  process.on('SIGTERM', () => void stop('SIGTERM'))
  process.stdin.resume()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
}
