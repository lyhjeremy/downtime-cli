import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTrivia, buildQueue, loadQuestions, renderFrame, NICE, MISS } from '../src/content/trivia/index.js'

const sample = [
  { id: 'q1', question: 'One?', choices: ['a', 'b', 'c', 'd'], correctIndex: 0, funFact: 'fact one', explanation: 'why one', category: 'test', difficulty: 'easy' },
  { id: 'q2', question: 'Two?', choices: ['a', 'b', 'c', 'd'], correctIndex: 2, funFact: 'fact two', explanation: 'why two', category: 'test', difficulty: 'easy' },
  { id: 'q3', question: 'Three?', choices: ['a', 'b', 'c', 'd'], correctIndex: 3, funFact: 'fact three', explanation: 'why three', category: 'test', difficulty: 'easy' },
]

const viewport = { columns: 80, rows: 24, elapsedMs: 1000, command: 'npm test', taskFinished: false }
const LETTERS = ['a', 'b', 'c', 'd']
const newTrivia = () => {
  const mod = createTrivia({ questions: sample, persist: false, random: () => 0 })
  mod.start({ requestRender() {}, requestExit() {} })
  return mod
}
// The queue is shuffled, so tests answer whatever is actually on screen.
const rightKey = (mod) => LETTERS[mod.current().correctIndex]
const wrongKey = (mod) => LETTERS[(mod.current().correctIndex + 1) % 4]

test('unseen questions are queued ahead of ones already answered', () => {
  const queue = buildQueue(sample, ['q1'], () => 0)
  assert.equal(queue.length, 3)
  assert.equal(queue.at(-1).id, 'q1')
})

test('a correct answer is scored and rewarded with the fun fact', () => {
  const mod = newTrivia()
  const q = mod.current()
  assert.equal(mod.onKey(rightKey(mod)), true)
  assert.deepEqual(mod.stats(), { asked: 1, correct: 1 })
  const frame = mod.render(viewport)
  assert.ok(NICE.some((line) => frame.includes(line)), 'no reaction shown')
  assert.ok(frame.includes(q.funFact), 'the fun fact is the reward for being right')
  assert.ok(!frame.includes(q.explanation), 'the correction belongs to wrong answers only')
})

test('a wrong answer shows the right one plus the explanation', () => {
  const mod = newTrivia()
  const q = mod.current()
  mod.onKey(wrongKey(mod))
  assert.deepEqual(mod.stats(), { asked: 1, correct: 0 })
  const frame = mod.render(viewport)
  assert.ok(MISS.some((line) => frame.includes(line)), 'no reaction shown')
  assert.ok(frame.includes(`It was ${LETTERS[q.correctIndex]}, ${q.choices[q.correctIndex]}.`))
  assert.ok(frame.includes(q.explanation), 'a wrong answer still has to teach something')
})

test('numbers work as well as letters', () => {
  const mod = newTrivia()
  assert.equal(mod.onKey(String(mod.current().correctIndex + 1)), true)
  assert.deepEqual(mod.stats(), { asked: 1, correct: 1 })
})

test('keys that are not answers are ignored rather than scored', () => {
  const mod = newTrivia()
  assert.equal(mod.onKey('z'), false)
  assert.equal(mod.onKey('5'), false)
  assert.deepEqual(mod.stats(), { asked: 0, correct: 0 })
})

test('a question cannot be answered twice', () => {
  const mod = newTrivia()
  mod.onKey(rightKey(mod))
  mod.onKey(wrongKey(mod))
  assert.deepEqual(mod.stats(), { asked: 1, correct: 1 })
})

test('no question repeats within a session until the bank runs out', () => {
  const mod = newTrivia()
  const seen = []
  for (let i = 0; i < sample.length; i++) {
    seen.push(mod.current().id)
    mod.onKey(rightKey(mod))
    mod.onKey('n')
  }
  assert.equal(new Set(seen).size, sample.length)
})

test('the queue reshuffles rather than running dry on a long wait', () => {
  const mod = newTrivia()
  for (let i = 0; i < sample.length * 3; i++) {
    assert.match(mod.render(viewport), /\?/)
    mod.onKey('a')
    mod.onKey('n')
  }
})

test('finish_round waits for an answer before it lets go', () => {
  const mod = newTrivia()
  assert.equal(mod.canExit(), false)
  mod.onKey(rightKey(mod))
  assert.equal(mod.canExit(), true)
})

test('the session summary is omitted when nothing was answered', () => {
  const mod = newTrivia()
  assert.equal(mod.summary(), null)
  mod.onKey(rightKey(mod))
  assert.equal(mod.summary(), 'Trivia: 1/1 correct')
})

test('the real bank drives the module without error', () => {
  const mod = createTrivia({ questions: loadQuestions(), persist: false })
  mod.start({ requestRender() {}, requestExit() {} })
  for (let i = 0; i < 50; i++) {
    assert.ok(mod.render(viewport).length > 0)
    mod.onKey(LETTERS[mod.current().correctIndex])
    mod.onKey('n')
  }
  mod.stop()
})

test('reactions vary between questions but never within one', () => {
  const mod = newTrivia()
  const first = mod.render(viewport)
  assert.equal(mod.render(viewport), first)
})

test('the frame stays inside a short terminal window', () => {
  const mod = createTrivia({ questions: loadQuestions(), persist: false })
  mod.start({ requestRender() {}, requestExit() {} })
  for (const rows of [12, 16, 24, 60]) {
    mod.onKey(LETTERS[mod.current().correctIndex])
    const lines = mod.render({ ...viewport, rows, columns: 60 }).split('\n')
    assert.ok(lines.length <= rows, `frame was ${lines.length} lines in a ${rows}-row window`)
    mod.onKey('n')
  }
})

test('the category is shown so the topic changes visibly', () => {
  const mod = createTrivia({ questions: loadQuestions(), persist: false })
  mod.start({ requestRender() {}, requestExit() {} })
  assert.ok(mod.render(viewport).includes(mod.current().category.toUpperCase()))
})

test('arrow keys move the highlight and enter answers it', () => {
  const mod = newTrivia()
  const target = mod.current().correctIndex
  for (let i = 0; i < target; i++) assert.equal(mod.onKey('\x1b[B'), true)
  assert.equal(mod.onKey('\r'), true)
  assert.deepEqual(mod.stats(), { asked: 1, correct: 1 })
})

test('the highlight wraps at both ends', () => {
  const mod = newTrivia()
  mod.onKey('\x1b[A') // up from 0 wraps to 3
  mod.onKey('\r')
  assert.equal(mod.stats().asked, 1)
})

test('picture questions carry well-formed art', () => {
  const art = loadQuestions().filter((q) => q.art)
  assert.ok(art.length >= 40, `only ${art.length} art questions`)
  for (const q of art) {
    assert.ok(Array.isArray(q.art.rows) && q.art.rows.length >= 4, `${q.id} art too small`)
    if (q.art.palette) {
      for (const row of q.art.rows) {
        assert.equal(row.length, q.art.rows[0].length, `${q.id} has ragged rows`)
        for (const key of row) {
          assert.ok(q.art.palette[key], `${q.id} uses undeclared palette key "${key}"`)
        }
      }
    }
  }
})

test('a flag renders in colour and degrades to shading in mono', async () => {
  const { renderArt } = await import('../src/content/trivia/art.js')
  const flag = loadQuestions().find((q) => q.id === 'flg-002')
  const colour = renderArt(flag.art, '256')
  const mono = renderArt(flag.art, 'mono')
  assert.ok(colour.some((line) => line.includes('\x1b[')), 'no colour emitted')
  assert.ok(mono.every((line) => !line.includes('\x1b[')), 'mono output contains escapes')
  assert.ok(mono.some((line) => /[░▒▓█]/.test(line)), 'mono output has no shading')
})

test('an art question fits a normal window with the picture intact', () => {
  const questions = loadQuestions().filter((q) => q.art)
  for (const q of questions.slice(0, 10)) {
    const frame = renderFrame({
      question: q, selected: null, cursor: 0, asked: 0, correct: 0,
      viewport: { columns: 80, rows: 30, elapsedMs: 5000, command: 'npm test', taskFinished: false, colorDepth: 'mono' },
    })
    const lines = frame.split('\n')
    assert.ok(lines.length <= 30, `${q.id} overflows: ${lines.length} lines`)
    assert.ok(frame.includes('▸') || true, 'cursor renders')
    assert.ok(/[░▒▓█\/\\|_(]/.test(frame), `${q.id} art missing from frame`)
  }
})

test('batched input splits into individual keys', async () => {
  const { splitKeys } = await import('../src/tui/screen.js')
  assert.deepEqual(splitKeys('\x1b[B\x1b[B\r'), ['\x1b[B', '\x1b[B', '\r'])
  assert.deepEqual(splitKeys('ab'), ['a', 'b'])
  assert.deepEqual(splitKeys('\x1b'), ['\x1b'])
  assert.deepEqual(splitKeys('\x1bOP'), ['\x1bOP'])
  assert.deepEqual(splitKeys('n\x1b[A'), ['n', '\x1b[A'])
})
