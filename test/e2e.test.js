import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'downtime')

async function downtime(args, options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'downtime-e2e-'))
  try {
    return await run(process.execPath, [bin, ...args], {
      env: { ...process.env, DOWNTIME_HOME: home, NO_COLOR: '1' },
      ...options,
    })
  } catch (err) {
    return err
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('a fast command is indistinguishable from running it bare', async () => {
  const result = await downtime(['run', 'node', '-e', 'console.log("hello"); console.error("problem")'])
  assert.equal(result.stdout, 'hello\n')
  assert.equal(result.stderr, 'problem\n')
})

test('the exit code is propagated so it composes with scripts and CI', async () => {
  const ok = await downtime(['run', 'node', '-e', 'process.exit(0)'])
  assert.equal(ok.code, undefined)
  const failed = await downtime(['run', 'node', '-e', 'process.exit(42)'])
  assert.equal(failed.code, 42)
})

test('output survives a command that outlasts the threshold', async () => {
  const result = await downtime([
    'run',
    '--threshold',
    '0',
    'node',
    '-e',
    'console.log("before"); setTimeout(() => { console.log("after"); process.exit(9) }, 300)',
  ])
  assert.equal(result.code, 9)
  assert.match(result.stdout, /before/)
  assert.match(result.stdout, /after/)
})

test('a command that does not exist reports why and exits 127', async () => {
  const result = await downtime(['run', 'definitely-not-a-real-binary-xyz'])
  assert.equal(result.code, 127)
  assert.match(result.stderr, /could not run/)
})

test('usage errors exit 2 without running anything', async () => {
  const result = await downtime(['run'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /needs a command/)
})

test('config prints the file location and current settings', async () => {
  const result = await downtime(['config'])
  assert.match(result.stdout, /config\.json/)
  assert.match(result.stdout, /"thresholdSeconds": 5/)
})
