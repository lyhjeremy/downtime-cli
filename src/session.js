import { constants } from 'node:os'
import { Runner } from './runner.js'
import { Screen } from './tui/screen.js'
import { buildRecap } from './recap.js'
import { createRegistry, assertContentModule } from './content/module.js'
import { createTrivia } from './content/trivia/index.js'
import { dim, CLEAR_LINE } from './tui/ansi.js'

export const registry = createRegistry()
registry.register('trivia', (options) => assertContentModule(createTrivia(options)))

const TICK_MS = 1000

function exitCodeFor(code, signal) {
  if (signal) {
    const num = constants.signals[signal]
    return num ? 128 + num : 1
  }
  return code ?? 0
}

async function drain(stream) {
  // The callback fires once this chunk is flushed, which is necessarily after
  // everything queued ahead of it.
  return new Promise((resolve) => stream.write('', () => resolve()))
}

/**
 * The pipeline. Wires the detection layer to the presentation layer and hands
 * the middle to whichever content module is configured. Nothing here knows what
 * trivia is.
 */
// A terminal has to be able to hold a full-screen drawing before we try one.
// TERM=dumb covers Emacs shell buffers, some IDE consoles and restricted CI
// shells; an unset TERM usually means the same thing. Getting this wrong fills
// someone's window with escape sequences.
export function terminalCanDrawTui(env = process.env) {
  if (env.DOWNTIME_DISABLE) return false
  const term = env.TERM
  if (!term) return false
  return !['dumb', 'unknown', 'cons25', 'emacs'].includes(term.toLowerCase())
}

export async function runSession({ command, args, config, contentOptions = {} }) {
  const interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY) && terminalCanDrawTui()

  const runner = new Runner(command, args, {
    thresholdSeconds: config.entry.thresholdSeconds,
    forwardStdin: !interactive,
    forceColor: interactive,
  })

  // Piped input or piped output means there is no terminal to take over. Behave
  // as a transparent wrapper so the tool composes with scripts and CI.
  if (!interactive) {
    return new Promise((resolve) => {
      runner.on('taskFinished', async ({ code, signal, error }) => {
        if (error) {
          process.stderr.write(`downtime: could not run ${command}: ${error.message}\n`)
        }
        await drain(process.stdout)
        resolve(exitCodeFor(code, signal))
      })
      runner.start()
    })
  }

  const screen = new Screen()
  let content = null
  let inDowntime = false
  let awaitingManualKey = false
  let finished = null
  let ticker = null
  let settled = false
  let resolveSession

  const done = new Promise((resolve) => {
    resolveSession = resolve
  })

  const viewport = () => ({
    columns: screen.columns,
    rows: screen.rows,
    elapsedMs: runner.durationMs(),
    command: [command, ...args].join(' '),
    taskFinished: Boolean(finished),
  })

  const paint = () => {
    if (inDowntime && content) screen.render(content.render(viewport()))
  }

  function enterDowntime() {
    if (inDowntime || finished) return
    stopManualPrompt()
    inDowntime = true
    runner.startCapture()

    content = registry.create(config.content.module, contentOptions)
    content.start({
      requestRender: paint,
      requestExit: () => leaveDowntime(),
    })

    screen.enter(handleKey)
    screen.onEnd(() => {
      // stdin closed, so no key can ever arrive. Never leave the session stuck
      // behind a prompt nobody can answer.
      if (finished) finish()
      else leaveDowntime({ resumeOutput: true })
    })
    screen.onResize(paint)
    paint()
    ticker = setInterval(paint, TICK_MS)
    ticker.unref?.()
  }

  function leaveDowntime({ resumeOutput = false } = {}) {
    if (!inDowntime) return
    inDowntime = false
    if (ticker) clearInterval(ticker)
    ticker = null
    try {
      content?.stop()
    } catch {}
    screen.leave()
    if (resumeOutput) {
      // Bailing out early while the command is still going: hand back everything
      // held so far and let the rest stream through as it normally would.
      runner.stopCapture()
      runner.flush()
    }
  }

  function handleKey(key) {
    if (key === '\x03') {
      // Ctrl-C inside downtime mode: kill the child, then fall through to the
      // normal finish path so output is still preserved. A second press means
      // the child is ignoring SIGINT, so stop asking.
      interrupt()
      return
    }
    if (finished && (key === '\r' || key === '\n')) {
      finish()
      return
    }
    if (key === 'q' || key === '\x1b') {
      // Escape hatch: leave the game but let the command carry on. A bare
      // Escape quits; arrow keys arrive as longer sequences (\x1b[A and so on)
      // and fall through to the content module instead.
      if (finished) finish()
      else leaveDowntime({ resumeOutput: true })
      return
    }
    const changed = content?.onKey(key)
    if (changed) paint()
  }

  // Manual entry: a single quiet line, and one key to accept it.
  let manualHandler = null
  let writesAtPrompt = 0
  function startManualPrompt() {
    awaitingManualKey = true
    writesAtPrompt = runner.writes
    process.stdout.write(dim('⏳ Still running. Press [d] for downtime mode') + '\n')
    if (process.stdin.setRawMode) process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    manualHandler = (data) => {
      const key = String(data).toLowerCase()
      if (key === '\x03') {
        interrupt()
        return
      }
      if (key === 'd') enterDowntime()
    }
    process.stdin.on('data', manualHandler)
  }

  function stopManualPrompt() {
    if (!awaitingManualKey) return
    awaitingManualKey = false
    if (manualHandler) process.stdin.off('data', manualHandler)
    manualHandler = null
    try {
      if (process.stdin.setRawMode) process.stdin.setRawMode(false)
    } catch {}
    process.stdin.pause()
    // Take the hint line back, but only if the command has not printed since.
    // Moving the cursor up over real output would eat a line of it.
    if (runner.writes === writesAtPrompt) {
      process.stdout.write('\x1b[1A' + CLEAR_LINE)
    }
  }

  async function finish() {
    if (settled) return
    settled = true
    const showRecap = inDowntime || (content !== null)
    leaveDowntime()
    stopManualPrompt()
    runner.dispose()
    process.off('SIGINT', onSignal)

    const summary = content?.summary?.() || null
    if (showRecap) {
      process.stdout.write(
        buildRecap({
          command,
          args,
          durationMs: runner.durationMs(),
          exitCode: finished?.code ?? 0,
          signal: finished?.signal,
          contentSummary: summary,
          width: screen.columns,
        }),
      )
    }
    runner.stopCapture()
    runner.flush()
    if (finished?.error) {
      process.stderr.write(`downtime: could not run ${command}: ${finished.error.message}\n`)
    }
    await drain(process.stdout)
    resolveSession(exitCodeFor(finished?.code ?? 130, finished?.signal))
  }

  let interrupts = 0
  function interrupt() {
    if (finished) {
      // The command is already gone. There is nothing to signal, and swallowing
      // this would leave the session hanging with no way out.
      finish()
      return
    }
    interrupts += 1
    runner.signal(interrupts === 1 ? 'SIGINT' : 'SIGKILL')
  }

  function onSignal() {
    interrupt()
  }

  runner.on('captureOverflow', () => {
    // Holding this much output is worse than ending the game early. Everything
    // captured so far is handed back and the rest streams as normal.
    leaveDowntime({ resumeOutput: true })
  })

  runner.on('thresholdCrossed', () => {
    if (config.entry.mode === 'manual') startManualPrompt()
    else enterDowntime()
  })

  runner.on('taskFinished', (event) => {
    finished = event
    if (!inDowntime) {
      finish()
      return
    }
    if (config.exit.mode === 'finish_round') {
      // Show the quiet indicator and let them land the answer in their own time.
      paint()
      return
    }
    finish()
  })

  process.on('SIGINT', onSignal)
  runner.start()

  return done
}
