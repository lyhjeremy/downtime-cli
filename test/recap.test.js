import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDuration, quoteCommand, buildRecap } from '../src/recap.js'

test('durations read naturally at every scale', () => {
  assert.equal(formatDuration(2340), '2.3s')
  assert.equal(formatDuration(45000), '45s')
  assert.equal(formatDuration(134000), '2m 14s')
  assert.equal(formatDuration(3725000), '1h 2m 5s')
})

test('commands with spaces are quoted so the recap can be copied and rerun', () => {
  assert.equal(quoteCommand('claude', ['-p', 'refactor the auth module']), 'claude -p "refactor the auth module"')
  assert.equal(quoteCommand('npm', ['test']), 'npm test')
})

test('the recap restates the command and how long it took', () => {
  const recap = buildRecap({
    command: 'npm',
    args: ['run', 'build'],
    durationMs: 134000,
    exitCode: 0,
    contentSummary: 'Trivia: 3/4 correct',
  })
  assert.match(recap, /npm run build/)
  assert.match(recap, /2m 14s/)
  assert.match(recap, /Exit code 0/)
  assert.match(recap, /Trivia: 3\/4 correct/)
})

test('a signalled exit says so instead of showing a code', () => {
  const recap = buildRecap({ command: 'sleep', args: ['30'], durationMs: 5000, exitCode: null, signal: 'SIGINT' })
  assert.match(recap, /Killed by SIGINT/)
})
