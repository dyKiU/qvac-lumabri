import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeEngineLine, renderHistory } from '../dist/lib/prompt.js'

test('renders complete history as exactly one engine protocol line', () => {
  const prompt = renderHistory([
    { role: 'system', content: 'be useful' },
    { role: 'user', content: 'first\nline' },
    { role: 'assistant', content: 'answer' },
    { role: 'user', content: 'next' }
  ])
  assert.equal(
    prompt,
    'System: be useful || User: first\\nline || Assistant: answer || User: next || Assistant:'
  )
  assert.equal(prompt.includes('\n'), false)
})

test('last-user mode and escaping are deterministic', () => {
  assert.equal(escapeEngineLine('a\\b\tc\rd'), 'a\\\\b\\tc\\rd')
  assert.equal(
    renderHistory(
      [{ role: 'assistant', content: 'old' }, { role: 'user', content: 'new' }],
      { mode: 'last-user' }
    ),
    'User: new'
  )
})

test('rejects empty and oversized histories', () => {
  assert.throws(() => renderHistory([]), /at least one/)
  assert.throws(
    () => renderHistory([{ role: 'user', content: '12345' }], { maxPromptBytes: 4 }),
    /exceeds 4 bytes/
  )
})
