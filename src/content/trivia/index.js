import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadState, saveState } from '../../state.js'
import { bold, dim, gray, green, red, cyan, yellow, wrapText } from '../../tui/ansi.js'

const here = dirname(fileURLToPath(import.meta.url))
const LETTERS = ['a', 'b', 'c', 'd']

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
 * Picks an order that puts never-seen questions first, then falls back to
 * previously-seen ones (shuffled) so a long session never runs dry.
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
  let selected = null // index of the answer the user pressed
  let asked = 0
  let correct = 0
  let ctx = null
  const seenThisSession = []

  function nextQuestion() {
    if (index >= queue.length) {
      // Everything has been shown once this session; reshuffle rather than stop.
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

    start(context) {
      ctx = context
      nextQuestion()
    },

    // True while a question is on screen and unanswered. finish_round uses this
    // to decide whether the user is mid-thought.
    get answered() {
      return selected !== null
    },

    canExit() {
      return selected !== null
    },

    // The question on screen right now. Used by the tests, and by any future
    // content that wants to theme itself around what is being asked.
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
      return renderFrame({
        question: current,
        selected,
        asked,
        correct,
        viewport,
      })
    },

    summary() {
      return asked > 0 ? `Trivia: ${correct}/${asked} correct` : null
    },

    stats() {
      return { asked, correct }
    },

    stop() {
      if (!persist) return
      const merged = [...state.seenQuestionIds.filter((id) => !seenThisSession.includes(id)), ...seenThisSession]
      saveState({ seenQuestionIds: merged })
    },
  }
}

function formatElapsed(ms) {
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
}

export function renderFrame({ question, selected, asked, correct, viewport }) {
  const columns = Math.max(40, Math.min(viewport.columns || 80, 100))
  const width = columns - 4
  const lines = []
  const pad = '  '

  // Header
  const tally = asked > 0 ? `${correct}/${asked}` : ''
  const left = cyan('downtime')
  const right = dim(formatElapsed(viewport.elapsedMs) + (tally ? ` · ${tally}` : ''))
  lines.push('')
  lines.push(pad + left + ' '.repeat(Math.max(1, width - 8 - stripLen(right))) + right)
  lines.push(pad + dim('─'.repeat(width)))
  lines.push('')

  if (!question) {
    lines.push(pad + dim('No questions available.'))
    return lines.join('\n')
  }

  // Question
  for (const line of wrapText(question.question, width)) {
    lines.push(pad + bold(line))
  }
  lines.push('')

  // Choices
  question.choices.forEach((choice, i) => {
    const letter = LETTERS[i]
    const isCorrect = i === question.correctIndex
    const isPicked = i === selected
    let marker = ' '
    let text = `${letter}) ${choice}`
    if (selected !== null) {
      if (isCorrect) {
        marker = green('✓')
        text = green(text)
      } else if (isPicked) {
        marker = red('✗')
        text = red(text)
      } else {
        text = dim(text)
      }
    }
    const wrapped = wrapText(text, width - 6)
    lines.push(pad + `  ${marker} ` + wrapped[0])
    for (const cont of wrapped.slice(1)) lines.push(pad + '     ' + cont)
  })
  lines.push('')

  // Feedback
  if (selected !== null) {
    const gotIt = selected === question.correctIndex
    lines.push(pad + (gotIt ? green(bold('Correct.')) : yellow(bold('Not quite.'))))
    const body = gotIt
      ? question.funFact
      : `The answer is ${LETTERS[question.correctIndex]}) ${question.choices[question.correctIndex]}. ${question.explanation}`
    for (const line of wrapText(body, width)) {
      lines.push(pad + gray(line))
    }
    lines.push('')
  }

  // Footer
  const hint =
    selected === null
      ? 'press a-d or 1-4 to answer'
      : viewport.taskFinished
        ? '[n] one more · [enter] back to your task'
        : '[n] next question'
  const status = viewport.taskFinished
    ? green('✅ task finished')
    : dim(`⏳ ${truncate(viewport.command, Math.max(12, width - 24))} · running`)

  lines.push(pad + dim('─'.repeat(width)))
  lines.push(pad + dim(hint))
  lines.push(pad + status)

  return lines.join('\n')
}

function stripLen(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').length
}

function truncate(s, max) {
  const str = String(s)
  return str.length <= max ? str : str.slice(0, Math.max(1, max - 1)) + '…'
}

export { formatElapsed }
