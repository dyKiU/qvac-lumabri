import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/**
 * Compares two versions of a git patch (such as native/lumabri-gateway-main.patch)
 * and reports whether the patch's own content changed.
 *
 * Rebasing a patch onto new upstream code legitimately moves context lines, hunk
 * offsets, hunk headers and `index` hashes. It must not add, remove, reorder, or
 * edit any `+`/`-` line, and must not add or remove files or change file modes.
 * Only the per-file sequence of those lines is compared.
 */

export interface PatchFile {
  path: string
  /** Mode, rename and create/delete lines from the file header. */
  meta: string[]
  /** `+`/`-` content lines (and no-newline markers) in patch order. */
  changes: string[]
}

export interface PatchContentComparison {
  ok: boolean
  differences: string[]
}

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/
const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/
const META_LINE = /^(?:new file mode|deleted file mode|old mode|new mode|rename from|rename to|copy from|copy to|Binary files|GIT binary patch)/

export function parsePatch(text: string): PatchFile[] {
  const files: PatchFile[] = []
  const lines = text.split('\n')
  let current: PatchFile | null = null
  let oldLeft = 0
  let newLeft = 0

  for (const line of lines) {
    if (oldLeft > 0 || newLeft > 0) {
      const marker = line[0]
      if (marker === '+') newLeft--
      else if (marker === '-') oldLeft--
      else if (marker === ' ' || line === '') {
        oldLeft--
        newLeft--
      } else if (marker === '\\') {
        current?.changes.push(line)
        continue
      } else {
        throw new Error(`Malformed patch: unexpected line inside hunk: ${line}`)
      }
      if (marker === '+' || marker === '-') current?.changes.push(line)
      continue
    }

    const header = FILE_HEADER.exec(line)
    if (header) {
      current = { path: header[2] ?? '', meta: [], changes: [] }
      files.push(current)
      continue
    }
    const hunk = HUNK_HEADER.exec(line)
    if (hunk) {
      if (!current) throw new Error('Malformed patch: hunk before any file header')
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1])
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2])
      continue
    }
    if (current && line.startsWith('\\')) {
      current.changes.push(line)
      continue
    }
    if (current && META_LINE.test(line)) current.meta.push(line)
  }
  if (oldLeft > 0 || newLeft > 0) throw new Error('Malformed patch: truncated final hunk')
  return files
}

function countLines(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)
  return counts
}

function multisetDifference(from: string[], other: string[]): string[] {
  const remaining = countLines(other)
  const extra: string[] = []
  for (const line of from) {
    const left = remaining.get(line) ?? 0
    if (left > 0) remaining.set(line, left - 1)
    else extra.push(line)
  }
  return extra
}

const SAMPLE_LIMIT = 5

function sample(prefix: string, lines: string[]): string[] {
  const shown = lines.slice(0, SAMPLE_LIMIT).map((line) => `${prefix} ${line}`)
  if (lines.length > SAMPLE_LIMIT) shown.push(`${prefix} ... and ${lines.length - SAMPLE_LIMIT} more`)
  return shown
}

export function comparePatchContent(base: string, head: string): PatchContentComparison {
  const baseFiles = new Map(parsePatch(base).map((file) => [file.path, file]))
  const headFiles = new Map(parsePatch(head).map((file) => [file.path, file]))
  const differences: string[] = []

  for (const path of baseFiles.keys()) {
    if (!headFiles.has(path)) differences.push(`${path}: file removed from patch`)
  }
  for (const path of headFiles.keys()) {
    if (!baseFiles.has(path)) differences.push(`${path}: file added to patch`)
  }

  for (const [path, baseFile] of baseFiles) {
    const headFile = headFiles.get(path)
    if (!headFile) continue
    if (baseFile.meta.join('\n') !== headFile.meta.join('\n')) {
      differences.push(`${path}: file header changed (${baseFile.meta.join('; ')} -> ${headFile.meta.join('; ')})`)
    }
    if (baseFile.changes.join('\n') === headFile.changes.join('\n')) continue

    const removed = multisetDifference(baseFile.changes, headFile.changes)
    const added = multisetDifference(headFile.changes, baseFile.changes)
    if (removed.length === 0 && added.length === 0) {
      differences.push(`${path}: patch lines were reordered`)
      continue
    }
    differences.push(
      `${path}: patch lines changed (${removed.length} dropped, ${added.length} new)`,
      ...sample('  base only:', removed),
      ...sample('  head only:', added)
    )
  }

  return { ok: differences.length === 0, differences }
}

async function main(argv: string[]): Promise<number> {
  const options = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if ((key !== '--base' && key !== '--head') || value === undefined) {
      process.stderr.write('Usage: check-gateway-patch-content.mts --base <patch> --head <patch>\n')
      return 2
    }
    options.set(key, value)
  }
  const basePath = options.get('--base')
  const headPath = options.get('--head')
  if (!basePath || !headPath) {
    process.stderr.write('Usage: check-gateway-patch-content.mts --base <patch> --head <patch>\n')
    return 2
  }

  let result: PatchContentComparison
  try {
    result = comparePatchContent(await readFile(basePath, 'utf8'), await readFile(headPath, 'utf8'))
  } catch (error) {
    process.stdout.write(`Gateway patch could not be compared: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  if (result.ok) {
    process.stdout.write('Gateway patch content: unchanged (relocation only)\n')
    return 0
  }
  process.stdout.write(`Gateway patch content changed:\n${result.differences.join('\n')}\n`)
  return 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2))
}
