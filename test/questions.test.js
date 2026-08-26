import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadQuestions } from '../src/content/trivia/index.js'

const questions = loadQuestions()

test('the bank is big enough that repeats are rare', () => {
  assert.ok(questions.length >= 500, `only ${questions.length} questions`)
})

test('topics are spread widely rather than clustered', () => {
  const categories = new Map()
  for (const q of questions) categories.set(q.category, (categories.get(q.category) || 0) + 1)
  assert.ok(categories.size >= 15, `only ${categories.size} categories`)
  for (const [category, count] of categories) {
    assert.ok(count >= 10, `${category} has only ${count} questions`)
  }
})

test('a question asks one thing, and the answer is not given away in it', () => {
  for (const q of questions) {
    assert.ok(q.question.split('?').length <= 2, `${q.id} asks more than one question`)
    const answer = q.choices[q.correctIndex].toLowerCase()
    if (answer.length > 12) {
      assert.ok(!q.question.toLowerCase().includes(answer), `${q.id} contains its own answer`)
    }
  }
})

test('the reward text is substantial enough to be worth reading', () => {
  for (const q of questions) {
    assert.ok(q.funFact.length >= 40, `${q.id} has a thin fun fact`)
    assert.ok(q.explanation.length >= 30, `${q.id} has a thin explanation`)
  }
})

test('every question is well formed', () => {
  for (const q of questions) {
    assert.equal(q.choices.length, 4, `${q.id} does not have 4 choices`)
    assert.equal(new Set(q.choices).size, 4, `${q.id} has a duplicate choice`)
    assert.ok(Number.isInteger(q.correctIndex), `${q.id} correctIndex not an integer`)
    assert.ok(q.correctIndex >= 0 && q.correctIndex < 4, `${q.id} correctIndex out of range`)
    for (const field of ['id', 'question', 'funFact', 'explanation', 'category', 'difficulty']) {
      assert.ok(q[field], `${q.id} is missing ${field}`)
    }
  }
})

test('question ids are unique', () => {
  const ids = questions.map((q) => q.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('the correct answer is spread across all four positions', () => {
  // If one letter were much more likely, always guessing it would beat playing.
  const counts = [0, 0, 0, 0]
  for (const q of questions) counts[q.correctIndex] += 1
  const expected = questions.length / 4
  for (const [position, count] of counts.entries()) {
    assert.ok(
      Math.abs(count - expected) < expected * 0.25,
      `position ${position} holds ${count} answers, expected near ${expected}`,
    )
  }
})
