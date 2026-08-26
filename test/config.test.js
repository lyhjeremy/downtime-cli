import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function withTempHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'downtime-test-'))
  const previous = process.env.DOWNTIME_HOME
  process.env.DOWNTIME_HOME = dir
  try {
    return fn(dir)
  } finally {
    if (previous === undefined) delete process.env.DOWNTIME_HOME
    else process.env.DOWNTIME_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

const { loadConfig, applyOverrides, DEFAULTS, configPath } = await import('../src/config.js')

test('the config file is created with defaults on first run', () => {
  withTempHome(() => {
    const { config, created } = loadConfig()
    assert.equal(created, true)
    assert.equal(config.entry.mode, 'auto')
    assert.equal(config.entry.thresholdSeconds, 5)
    assert.equal(config.exit.mode, 'immediate')
    assert.deepEqual(JSON.parse(readFileSync(configPath(), 'utf8')), DEFAULTS)
  })
})

test('a partial config keeps the defaults for everything it omits', () => {
  withTempHome(() => {
    loadConfig()
    writeFileSync(configPath(), JSON.stringify({ entry: { thresholdSeconds: 30 } }))
    const { config } = loadConfig()
    assert.equal(config.entry.thresholdSeconds, 30)
    assert.equal(config.entry.mode, 'auto')
    assert.equal(config.exit.mode, 'immediate')
  })
})

test('nonsense values fall back to defaults and say so', () => {
  withTempHome(() => {
    loadConfig()
    writeFileSync(configPath(), JSON.stringify({ entry: { mode: 'sideways', thresholdSeconds: -4 }, exit: { mode: 'never' } }))
    const { config, warnings } = loadConfig()
    assert.equal(config.entry.mode, 'auto')
    assert.equal(config.entry.thresholdSeconds, 5)
    assert.equal(config.exit.mode, 'immediate')
    assert.equal(warnings.length, 3)
  })
})

test('a corrupt config file is reported, not silently overwritten', () => {
  withTempHome(() => {
    loadConfig()
    writeFileSync(configPath(), '{ this is not json')
    const { config, warnings } = loadConfig()
    assert.equal(config.entry.thresholdSeconds, 5)
    assert.match(warnings[0], /could not parse/)
    assert.match(readFileSync(configPath(), 'utf8'), /this is not json/)
  })
})

test('per-run flags override the file without touching it', () => {
  const merged = applyOverrides(DEFAULTS, { entry: { thresholdSeconds: 12 }, exit: { mode: 'finish_round' } })
  assert.equal(merged.entry.thresholdSeconds, 12)
  assert.equal(merged.exit.mode, 'finish_round')
  assert.equal(merged.entry.mode, 'auto')
  assert.equal(DEFAULTS.entry.thresholdSeconds, 5)
})
