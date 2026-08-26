import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadState, saveState } from '../../state.js'
import { bold, dim, gray, green, red, cyan, yellow, wrapText, visibleLength } from '../../tui/ansi.js'

const here = dirname(fileURLToPath(import.meta.url))
const LETTERS = ['a', 'b', 'c', 'd']

// Reactions rotate so the screen does not say the same word at you all evening.
// They are picked from the question id rather than at random, so a given
// question always reads the same way and the tests stay honest.
export const NICE = ['Nice one.', 'Got it.', 'Correct.', "That's the one.", 'Spot on.', 'Yes.']
export const MISS = ['Not this time.', 'Nope.', 'Not quite.', 'Close, but no.']

function pick(list, seed) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return list[hash % list.length]
}

export function loadQuestions(path = join(here, 'questions.json')) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  return Array.isArray(parsed) ? parsed : parsed.questions
}

function shuffle(items, random = Math.random) {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Puts never-seen questions first, then previously-seen ones, so a long wait
 * never runs dry but a short one never repeats.
 */
export function buildQueue(questions, seenIds, random = Math.random) {
  const seen = new Set(seenIds)
  const fresh = questions.filter((q) => !seen.has(q.id))
  const stale = questions.filter((q) => seen.has(q.id))
  return [...shuffle(fresh, random), ...shuffle(stale, random)]
}

export function createTrivia(options = {}) {
  const questions = options.questions || loadQuestions()
  const random = options.random || Math.random
  const persist = options.persist !== false
  const state = persist ? loadState() : { seenQuestionIds: [] }

  let queue = buildQueue(questions, state.seenQuestionIds, random)
  let index = 0
  let current = null
  let selected = null
  let asked = 0
  let correct = 0
  const seenThisSession = []

  function nextQuestion() {
    if (index >= queue.length) {
      queue = shuffle(questions, random)
      index = 0
    }
    current = queue[index++]
    selected = null
    if (current) seenThisSession.push(current.id)
  }

  return {
    id: 'trivia',
    title: 'Trivia',

    start() {
      nextQuestion()
    },

    canExit() {
      return selected !== null
    },

    current() {
      return current
    },

    onKey(key) {
      const k = key.toLowerCase()
      if (selected === null) {
        const byLetter = LETTERS.indexOf(k)
        const byNumber = '1234'.indexOf(k)
        const choice = byLetter >= 0 ? byLetter : byNumber
        if (choice >= 0 && current && choice < current.choices.length) {
          selected = choice
          asked += 1
          if (choice === current.correctIndex) correct += 1
          return true
        }
        return false
      }
      if (k === 'n' || key === '\r' || key === '\n' || key === ' ') {
        nextQuestion()
        return true
      }
      return false
    },

    render(viewport) {
      return renderFrame({ question: current, selected, asked, correct, viewport })
    },

    summary() {
      return asked > 0 ? `Trivia: ${correct}/${asked} correct` : null
    },

    stats() {
      return { asked, correct }
    },

    stop() {
      if (!persist) return
      const kept = state.seenQuestionIds.filter((id) => !seenThisSession.includes(id))
      saveState({ seenQuestionIds: [...kept, ...seenThisSession] })
    },
  }
}

export function formatElapsed(ms) {
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
}

function truncate(s, max) {
  const str = String(s)
  return str.length <= max ? str : str.slice(0, Math.max(1, max - 1)) + '…'
}

export function renderFrame({ question, selected, asked, correct, viewport }) {
  const rows = Math.max(8, viewport.rows || 24)
  const columns = Math.max(40, Math.min(viewport.columns || 80, 92))
  const width = columns - 4
  const pad = '  '
  const answered = selected !== null

  if (!question) return `\n${pad}${dim('No questions available.')}\n`

  // Every line carries a priority. 0 has to survive; higher numbers are given
  // up first when the window is short. Breathing room goes before content, and
  // content goes before the keys you need to get out of here.
  const lines = []
  const add = (text, priority = 0) => lines.push({ text, priority })

  const left = cyan('downtime')
  const tally = asked > 0 ? ` ${dim('·')} ${correct} of ${asked}` : ''
  const right = dim(formatElapsed(viewport.elapsedMs)) + tally
  const gap = Math.max(1, width - visibleLength(left) - visibleLength(right))

  add('', 9)
  add(pad + left + ' '.repeat(gap) + right, 1)
  add('', 9)
  if (question.category) {
    add(pad + dim(question.category.toUpperCase()), 6)
    add('', 8)
  }

  for (const line of wrapText(question.question, width)) add(pad + bold(line), 0)
  add('', 7)

  question.choices.forEach((choice, i) => {
    const isCorrect = i === question.correctIndex
    const isPicked = i === selected
    let mark = ' '
    let label = dim(LETTERS[i])
    let text = choice
    if (answered) {
      if (isCorrect) {
        mark = green('✓')
        label = green(LETTERS[i])
        text = green(choice)
      } else if (isPicked) {
        mark = red('✗')
        label = red(LETTERS[i])
        text = red(choice)
      } else {
        text = dim(choice)
      }
    }
    const wrapped = wrapText(text, width - 7)
    add(pad + `  ${mark} ${label}  ` + wrapped[0], 0)
    for (const cont of wrapped.slice(1)) add(pad + ' '.repeat(7) + cont, 0)
  })

  // Being right earns a fact, being wrong earns a different one, and neither is
  // a telling-off.
  if (answered) {
    const gotIt = selected === question.correctIndex
    add('', 7)
    if (gotIt) {
      add(pad + green('✓ ') + bold(pick(NICE, question.id)), 2)
      for (const line of wrapText(question.funFact, width - 2)) add(pad + '  ' + gray(line), 3)
    } else {
      add(pad + yellow('· ') + bold(pick(MISS, question.id)), 2)
      const answer = `It was ${LETTERS[question.correctIndex]}, ${question.choices[question.correctIndex]}.`
      for (const line of wrapText(`${answer} ${question.explanation}`, width - 2)) {
        add(pad + '  ' + gray(line), 3)
      }
    }
  }

  const hints = answered
    ? viewport.taskFinished
      ? `${bold('[enter]')} back to your task   ${dim('[n] one more')}`
      : `${bold('[n]')} next question   ${dim('[q] back to your task')}`
    : dim('press a-d or 1-4')
  const status = viewport.taskFinished
    ? green('✅ task finished')
    : dim(`⏳ ${truncate(viewport.command, Math.max(10, width - 24))}`)
  const statusGap = Math.max(2, width - visibleLength(hints) - visibleLength(status))
  add('', 8)
  add(pad + dim('─'.repeat(width)), 5)
  add(pad + hints + ' '.repeat(statusGap) + status, 0)

  // Give up the least important lines until it fits. Dropping from the end of a
  // priority band means a long fact is shortened rather than beheaded.
  while (lines.length > rows) {
    let worst = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].priority > 0 && (worst === -1 || lines[i].priority >= lines[worst].priority)) worst = i
    }
    if (worst === -1) break
    lines.splice(worst, 1)
  }

  return lines.slice(0, rows).map((line) => line.text).join('\n')
}
