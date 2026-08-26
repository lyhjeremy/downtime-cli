import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

export const DEFAULTS = {
  entry: {
    mode: 'auto', // 'auto' | 'manual'
    thresholdSeconds: 5,
  },
  exit: {
    mode: 'immediate', // 'immediate' | 'finish_round'
  },
  content: {
    module: 'trivia',
  },
}

// DOWNTIME_HOME exists so the test suite never touches a real user's state.
export function stateDir() {
  return process.env.DOWNTIME_HOME || join(homedir(), '.downtime')
}

export function configPath() {
  return join(stateDir(), 'config.json')
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function merge(base, override) {
  const out = { ...base }
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = isObject(value) && isObject(base[key]) ? merge(base[key], value) : value
  }
  return out
}

export function ensureStateDir() {
  const dir = stateDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

// Reads config, creating it with defaults on first run. A malformed file is
// reported rather than silently replaced, so nobody loses hand-edited settings.
export function loadConfig() {
  ensureStateDir()
  const path = configPath()
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULTS, null, 2) + '\n')
    return { config: structuredClone(DEFAULTS), created: true, warnings: [] }
  }
  let parsed = {}
  const warnings = []
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    warnings.push(`could not parse ${path} (${err.message}); using defaults`)
  }
  const config = merge(DEFAULTS, parsed)
  return { config: validate(config, warnings), created: false, warnings }
}

export function validate(config, warnings = []) {
  const out = merge(DEFAULTS, config)
  if (!['auto', 'manual'].includes(out.entry.mode)) {
    warnings.push(`entry.mode "${out.entry.mode}" is not auto or manual; using auto`)
    out.entry.mode = DEFAULTS.entry.mode
  }
  const threshold = Number(out.entry.thresholdSeconds)
  if (!Number.isFinite(threshold) || threshold < 0) {
    warnings.push(`entry.thresholdSeconds "${out.entry.thresholdSeconds}" is not a positive number; using ${DEFAULTS.entry.thresholdSeconds}`)
    out.entry.thresholdSeconds = DEFAULTS.entry.thresholdSeconds
  } else {
    out.entry.thresholdSeconds = threshold
  }
  if (!['immediate', 'finish_round'].includes(out.exit.mode)) {
    warnings.push(`exit.mode "${out.exit.mode}" is not immediate or finish_round; using immediate`)
    out.exit.mode = DEFAULTS.exit.mode
  }
  return out
}

export function applyOverrides(config, overrides) {
  return validate(merge(config, overrides))
}
