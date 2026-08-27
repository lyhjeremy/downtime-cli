import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from '../src/cli.js'

test('a bare command is passed through untouched', () => {
  const parsed = parseArgs(['run', 'npm', 'run', 'build'])
  assert.equal(parsed.command, 'run')
  assert.equal(parsed.target, 'npm')
  assert.deepEqual(parsed.targetArgs, ['run', 'build'])
})

test('flags before the command are read as overrides', () => {
  const parsed = parseArgs(['run', '--threshold', '15', '--exit', 'finish_round', 'pytest', '-x'])
  assert.deepEqual(parsed.overrides, {
    entry: { thresholdSeconds: 15 },
    exit: { mode: 'finish_round' },
  })
  assert.equal(parsed.target, 'pytest')
  assert.deepEqual(parsed.targetArgs, ['-x'])
})

test('a double dash protects flags that belong to the wrapped command', () => {
  const parsed = parseArgs(['run', '-t', '2', '--', 'ls', '--threshold', '-t'])
  assert.equal(parsed.target, 'ls')
  assert.deepEqual(parsed.targetArgs, ['--threshold', '-t'])
})

test('the first non-flag token starts the command even without a double dash', () => {
  const parsed = parseArgs(['run', 'claude', '-p', 'refactor the auth module'])
  assert.equal(parsed.target, 'claude')
  assert.deepEqual(parsed.targetArgs, ['-p', 'refactor the auth module'])
})

test('bad input is rejected rather than guessed at', () => {
  assert.throws(() => parseArgs(['run']), /needs a command/)
  assert.throws(() => parseArgs(['run', '--entry', 'sometimes', 'ls']), /auto or manual/)
  assert.throws(() => parseArgs(['run', '--threshold', 'soon', 'ls']), /number of seconds/)
  assert.throws(() => parseArgs(['run', '--nope', 'ls']), /unknown option/)
})

test('the short form treats the first word as the command to wrap', () => {
  const parsed = parseArgs(['npm', 'run', 'build'])
  assert.equal(parsed.command, 'run')
  assert.equal(parsed.target, 'npm')
  assert.deepEqual(parsed.targetArgs, ['run', 'build'])
  const withFlags = parseArgs(['-t', '3', 'pytest', '-x'])
  assert.equal(withFlags.target, 'pytest')
  assert.deepEqual(withFlags.overrides, { entry: { thresholdSeconds: 3 } })
})

test('help and version are recognised', () => {
  assert.equal(parseArgs([]).command, 'help')
  assert.equal(parseArgs(['--help']).command, 'help')
  assert.equal(parseArgs(['-v']).command, 'version')
  assert.equal(parseArgs(['config']).command, 'config')
})
