#!/usr/bin/env node
import readline from 'node:readline'

process.stdout.write('{"v":1,"type":"ready","protocol":"framed","model":"fake"}\n')

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of input) {
  const request = JSON.parse(line)
  if (request.op === 'shutdown') {
    process.stdout.write(JSON.stringify({ v: 1, id: request.id, type: 'bye' }) + '\n')
    process.exit(0)
  }
  const prompt = Buffer.from(request.prompt, 'base64').toString('utf8')
  if (prompt.includes('WAIT')) continue

  const reply = Buffer.from(`reply(${prompt}) 🦜`, 'utf8')
  // Split inside the four-byte emoji to exercise incremental UTF-8 handling.
  const split = reply.length - 2
  for (const bytes of [reply.subarray(0, split), reply.subarray(split)]) {
    process.stdout.write(JSON.stringify({
      v: 1,
      id: request.id,
      type: 'delta',
      data: bytes.toString('base64')
    }) + '\n')
  }
  process.stdout.write(JSON.stringify({
    v: 1,
    id: request.id,
    type: 'done',
    stats: { generatedTokens: 3, tokensPerSecond: 12.5 }
  }) + '\n')
}
