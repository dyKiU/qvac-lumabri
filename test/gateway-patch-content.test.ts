import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { comparePatchContent, parsePatch } from '../scripts/check-gateway-patch-content.mts'

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/gateway-patch/${name}`, import.meta.url), 'utf8')

function hunk(oldStart: number, newStart: number, lines: string[], heading = ''): string {
  const oldCount = lines.filter((line) => !line.startsWith('+')).length
  const newCount = lines.filter((line) => !line.startsWith('-')).length
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${heading}\n${lines.join('\n')}\n`
}

function lumabriPatch(options: {
  index?: string
  firstHunk?: string
  secondHunk?: string
  mode?: string
}): string {
  return `diff --git a/lumabri.c b/lumabri.c
index ${options.index ?? '1111111..2222222'} 100644
--- a/lumabri.c
+++ b/lumabri.c
${options.firstHunk ?? hunk(10, 10, ['     int a = 1;', '     int b = 2;', '-    int c = 3;', '+    int c = 4;', '+    int d = 5;', '     return a + b;'], ' int main(void) {')}${options.secondHunk ?? hunk(50, 51, ['     helper_one();', '+    helper_two();', '     helper_three();'], ' static void helper(void) {')}diff --git a/gateway_test.sh b/gateway_test.sh
new file mode ${options.mode ?? '100755'}
index 0000000..3333333
--- /dev/null
+++ b/gateway_test.sh
@@ -0,0 +1,2 @@
+#!/bin/sh
+echo ok
`
}

const base = lumabriPatch({})

test('identical patches compare equal', () => {
  assert.deepEqual(comparePatchContent(base, base), { ok: true, differences: [] })
})

test('relocation only: new offsets, hunk headers, context lines and index hashes pass', () => {
  const rebased = lumabriPatch({
    index: 'aaaaaaa..bbbbbbb',
    firstHunk: hunk(
      42,
      45,
      [
        '     int a0 = 0;',
        '     int a = 1;',
        '     int b = 2;',
        '-    int c = 3;',
        '+    int c = 4;',
        '+    int d = 5;',
        '     int b2 = 3;',
        '     return a + b;'
      ],
      ' int main_entry(void) {'
    ),
    secondHunk: hunk(120, 130, ['     helper_one();', '+    helper_two();', '     helper_three_renamed();'])
  })
  assert.notEqual(rebased, base)
  assert.deepEqual(comparePatchContent(base, rebased), { ok: true, differences: [] })
})

test('splitting or merging hunks around unchanged +/- lines still passes', () => {
  const merged = lumabriPatch({
    firstHunk: hunk(10, 10, [
      '     int a = 1;',
      '-    int c = 3;',
      '+    int c = 4;',
      '+    int d = 5;',
      '     return a + b;',
      '     helper_one();',
      '+    helper_two();'
    ]),
    secondHunk: ''
  })
  assert.deepEqual(comparePatchContent(base, merged), { ok: true, differences: [] })
})

test('a changed + line is rejected', () => {
  const result = comparePatchContent(base, base.replace('+    int c = 4;', '+    int c = 99;'))
  assert.equal(result.ok, false)
  assert.match(result.differences.join('\n'), /lumabri\.c: patch lines changed \(1 dropped, 1 new\)/)
  assert.match(result.differences.join('\n'), /base only:.*\+    int c = 4;/)
  assert.match(result.differences.join('\n'), /head only:.*\+    int c = 99;/)
})

test('a removed + line is rejected', () => {
  const withoutHelper = lumabriPatch({
    secondHunk: hunk(50, 51, ['     helper_one();', '     helper_three();'])
  })
  const result = comparePatchContent(base, withoutHelper)
  assert.equal(result.ok, false)
  assert.match(result.differences.join('\n'), /1 dropped, 0 new/)
})

test('an added + line is rejected', () => {
  const withExtraLine = lumabriPatch({
    firstHunk: hunk(10, 10, [
      '     int a = 1;',
      '     int b = 2;',
      '-    int c = 3;',
      '+    int c = 4;',
      '+    int d = 5;',
      '+    int e = 6;',
      '     return a + b;'
    ])
  })
  const result = comparePatchContent(base, withExtraLine)
  assert.equal(result.ok, false)
  assert.match(result.differences.join('\n'), /0 dropped, 1 new/)
})

test('a changed or removed - line is rejected', () => {
  const changed = comparePatchContent(base, base.replace('-    int c = 3;', '-    int c = 30;'))
  assert.equal(changed.ok, false)
  const removed = comparePatchContent(
    base,
    lumabriPatch({
      firstHunk: hunk(10, 10, ['     int a = 1;', '     int b = 2;', '+    int c = 4;', '+    int d = 5;', '     return a + b;'])
    })
  )
  assert.equal(removed.ok, false)
})

test('reordered +/- lines are rejected', () => {
  const reordered = base.replace('+    int c = 4;\n+    int d = 5;\n', '+    int d = 5;\n+    int c = 4;\n')
  const result = comparePatchContent(base, reordered)
  assert.equal(result.ok, false)
  assert.match(result.differences.join('\n'), /reordered/)
})

test('added, removed, and re-moded files are rejected', () => {
  const withoutFile = base.slice(0, base.indexOf('diff --git a/gateway_test.sh'))
  assert.match(comparePatchContent(base, withoutFile).differences.join('\n'), /gateway_test\.sh: file removed/)
  assert.match(comparePatchContent(withoutFile, base).differences.join('\n'), /gateway_test\.sh: file added/)
  const remoded = base.replace('new file mode 100755', 'new file mode 100644')
  assert.match(comparePatchContent(base, remoded).differences.join('\n'), /file header changed/)
})

test('content lines that look like diff headers are treated as content', () => {
  const tricky = `diff --git a/doc.txt b/doc.txt
index 1111111..2222222 100644
--- a/doc.txt
+++ b/doc.txt
@@ -1,3 +1,3 @@
 keep
--- not a file header
+++ not a file header either
 end
`
  const [file] = parsePatch(tricky)
  assert.deepEqual(file?.changes, ['--- not a file header', '+++ not a file header either'])
  assert.equal(comparePatchContent(tricky, tricky.replace('+++ not', '+++ different')).ok, false)
})

test('malformed patches throw instead of passing silently', () => {
  assert.throws(() => parsePatch('diff --git a/x b/x\n@@ -1,5 +1,5 @@\n one\n'), /truncated/)
})

test('PR #94 gateway patch change is rejected (engine_patches/make_patches.py rewritten)', async () => {
  const result = comparePatchContent(
    await fixture('pr94-base-make_patches.patch'),
    await fixture('pr94-head-make_patches.patch')
  )
  assert.equal(result.ok, false)
  const report = result.differences.join('\n')
  assert.match(report, /engine_patches\/make_patches\.py: patch lines changed/)
  assert.match(report, /head only:.*acquire = /)
})

test('PR #94 base patch relocated onto different context passes', async () => {
  const original = await fixture('pr94-base-make_patches.patch')
  const relocated = original
    .replace(/^index [0-9a-f]+\.\.[0-9a-f]+/m, 'index 0000000..1111111')
    .replace(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/gm, (_m, a, b, c, d) => `@@ -${Number(a) + 7},${b} +${Number(c) + 9},${d} @@`)
    .replace('     stop = "            float w = val[kk];\\n"\n', '     stop = "            float w2 = val[kk];\\n"\n')
  assert.notEqual(relocated, original)
  assert.deepEqual(comparePatchContent(original, relocated), { ok: true, differences: [] })
})
