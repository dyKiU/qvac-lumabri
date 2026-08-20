const ROLE_LABELS: Readonly<Record<string, string>> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool'
}

export interface HistoryMessage {
  role: string
  content: string
}

export interface RenderHistoryOptions {
  mode?: 'full' | 'last-user'
  maxPromptBytes?: number
}

export function escapeEngineLine(value: unknown): string {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
}

/**
 * Render QVAC history into the single input line accepted by the current
 * Colibri chat/serve protocols. Lumabri resets before every request, so the
 * complete history is explicit and cannot leak between QVAC sessions.
 */
export function renderHistory(
  history: readonly HistoryMessage[],
  options: RenderHistoryOptions = {}
): string {
  const { mode = 'full', maxPromptBytes = 1024 * 1024 } = options
  if (!Array.isArray(history) || history.length === 0) {
    throw new Error('completion history must contain at least one message')
  }

  let selected = history
  if (mode === 'last-user') {
    let lastUser: HistoryMessage | undefined
    for (let i = history.length - 1; i >= 0; i--) {
      const message = history[i]
      if (message?.role === 'user') { lastUser = message; break }
    }
    selected = lastUser ? [lastUser] : []
  }

  if (selected.length === 0) throw new Error('history has no user message')

  const parts = selected.map((message) => {
    const label = ROLE_LABELS[message.role] ?? escapeEngineLine(message.role)
    return `${label}: ${escapeEngineLine(message.content)}`
  })
  if (mode === 'full') parts.push('Assistant:')

  const prompt = parts.join(' || ')
  if (Buffer.byteLength(prompt, 'utf8') > maxPromptBytes) {
    throw new Error(`rendered prompt exceeds ${maxPromptBytes} bytes`)
  }
  return prompt
}
