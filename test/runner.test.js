import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { Runner } from '../src/runner.js'

test('a finished command reports its exit code and duration', async () => {
  const runner = new Runner('node', ['-e', 'process.exit(3)'], { thresholdSeconds: 60 })
  runner.startCapture()
  runner.start()
  const [event] = await once(runner, 'taskFinished')
  assert.equal(event.code, 3)
  assert.ok(event.durationMs >= 0)
})

test('captured output keeps its order within each stream', async () => {
  // stdout and stderr arrive on separate pipes, so their order relative to each
  // other is not guaranteed. Order within a stream is, and that is what gets
  // replayed. See the fidelity note in the README.
  const runner = new Runner(
    'node',
    ['-e', 'process.stdout.write("one\\n"); process.stderr.write("problem\\n"); process.stdout.write("two\\n")'],
    { thresholdSeconds: 60 },
  )
  runner.startCapture()
  runner.start()
  await once(runner, 'taskFinished')

  const streamText = (name) =>
    runner.buffer
      .filter((entry) => entry.stream === name)
      .map((entry) => entry.chunk.toString())
      .join('')

  const out = streamText('stdout')
  assert.ok(out.indexOf('one') < out.indexOf('two'), 'stdout order was not preserved')
  assert.match(streamText('stderr'), /problem/)
  assert.match(runner.capturedText(), /one/)
})

test('the threshold fires only when the command outlasts it', async () => {
  const slow = new Runner('node', ['-e', 'setTimeout(() => {}, 400)'], { thresholdSeconds: 0.05 })
  slow.startCapture()
  slow.start()
  const [crossed] = await once(slow, 'thresholdCrossed')
  assert.ok(crossed.elapsedMs >= 0)
  await once(slow, 'taskFinished')

  const fast = new Runner('node', ['-e', ''], { thresholdSeconds: 30 })
  fast.startCapture()
  let fired = false
  fast.on('thresholdCrossed', () => {
    fired = true
  })
  fast.start()
  await once(fast, 'taskFinished')
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(fired, false)
})

test('a command that cannot be spawned resolves rather than hanging', async () => {
  const runner = new Runner('definitely-not-a-real-binary-xyz', [], { thresholdSeconds: 60 })
  runner.startCapture()
  runner.start()
  const [event] = await once(runner, 'taskFinished')
  assert.equal(event.code, 127)
  assert.ok(event.error)
})

test('an interrupt takes the whole process tree, not just the direct child', async () => {
  // `sh -c` runs sleep as a grandchild. Signalling only the shell would leave
  // the sleep running and the wrapper waiting on it.
  const runner = new Runner('sh', ['-c', 'sleep 30'], { thresholdSeconds: 60 })
  runner.startCapture()
  runner.start()
  await new Promise((resolve) => setTimeout(resolve, 150))
  runner.signal('SIGINT')
  const [event] = await once(runner, 'taskFinished')
  assert.ok(event.durationMs < 5000, `took ${event.durationMs}ms, so the tree was not killed`)
})

test('a firehose of output ends the game rather than eating memory', async () => {
  const runner = new Runner(
    'node',
    ['-e', 'const l="x".repeat(1000)+"\\n"; for(let i=0;i<300;i++) process.stdout.write(l)'],
    { thresholdSeconds: 60, captureLimitBytes: 50_000 },
  )
  runner.startCapture()
  let overflow = null
  runner.on('captureOverflow', (event) => {
    overflow = event
    runner.stopCapture()
    runner.flush()
  })
  runner.start()
  await once(runner, 'taskFinished')
  assert.ok(overflow, 'no overflow was reported')
  assert.ok(overflow.bufferedBytes > 50_000)
  assert.ok(runner.bufferedBytes < 50_000, 'buffer was not released')
})

test('the overflow warning fires once, not on every chunk', async () => {
  const runner = new Runner(
    'node',
    ['-e', 'const l="y".repeat(1000)+"\\n"; for(let i=0;i<300;i++) process.stdout.write(l)'],
    { thresholdSeconds: 60, captureLimitBytes: 10_000 },
  )
  runner.startCapture()
  let count = 0
  runner.on('captureOverflow', () => (count += 1))
  runner.start()
  await once(runner, 'taskFinished')
  assert.equal(count, 1)
})
