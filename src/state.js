import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { ensureStateDir, stateDir } from './config.js'

// Seen-question tracking so the same trivia does not come round again next week.
// Capped, because this file should stay a few KB forever.
const MAX_SEEN = 400

export function statePath() {
  return join(stateDir(), 'state.json')
}

export function loadState() {
  const path = statePath()
  if (!existsSync(path)) return { seenQuestionIds: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return {
      seenQuestionIds: Array.isArray(parsed.seenQuestionIds) ? parsed.seenQuestionIds : [],
    }
  } catch {
    return { seenQuestionIds: [] }
  }
}

export function saveState(state) {
  try {
    ensureStateDir()
    const seen = state.seenQuestionIds.slice(-MAX_SEEN)
    writeFileSync(statePath(), JSON.stringify({ seenQuestionIds: seen }, null, 2) + '\n')
  } catch {
    // Losing repeat-avoidance is not worth crashing someone's build wrapper over.
  }
}
