import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

/**
 * The detection layer. Knows about child processes and time, and nothing about
 * trivia or terminals. Everything downstream subscribes to these events:
 *
 *   taskStarted       { command, args, startedAt }
 *   thresholdCrossed  { elapsedMs }
 *   output            { stream: 'stdout' | 'stderr', chunk: Buffer }
 *   taskNeedsInput    { reason }            reserved; see README limitations
 *   taskFinished      { code, signal, durationMs }
 *
 * Future tiers (a multi-terminal dashboard, a relay to a phone) subscribe to the
 * same events rather than reaching into the process handling.
 */
export class Runner extends EventEmitter {
  constructor(command, args = [], options = {}) {
    super()
    this.command = command
    this.args = args
    this.thresholdMs = Math.round((options.thresholdSeconds ?? 5) * 1000)
    this.forwardStdin = Boolean(options.forwardStdin)
    this.forceColor = Boolean(options.forceColor)
    this.child = null
    this.startedAt = null
    this.finishedAt = null
    this.result = null
    this.capturing = false
    this.buffer = []
    this.thresholdTimer = null
    this.thresholdCrossed = false
    this.writes = 0
  }

  start() {
    this.startedAt = Date.now()
    // When we own the keyboard we also put the child in its own process group,
    // so Ctrl-C can be forwarded to the whole tree. Killing only the direct
    // child leaves grandchildren (the sleep inside an `sh -c`) running.
    // In passthrough we do neither: the child stays in our group and the
    // terminal delivers signals to it directly, exactly as if we were not here.
    this.detached = !this.forwardStdin && process.platform !== 'win32'
    this.child = spawn(this.command, this.args, {
      // stdin is /dev/null unless we are in plain passthrough. Downtime mode owns
      // the keyboard, and a child sharing the TTY would fight it for keystrokes.
      stdio: [this.forwardStdin ? 'inherit' : 'ignore', 'pipe', 'pipe'],
      detached: this.detached,
      env: this.#childEnv(),
    })

    this.child.on('error', (err) => {
      this.finishedAt = Date.now()
      this.result = { code: 127, signal: null, error: err }
      this.emit('taskFinished', {
        code: 127,
        signal: null,
        durationMs: this.durationMs(),
        error: err,
      })
    })

    this.child.stdout?.on('data', (chunk) => this.#onOutput('stdout', chunk))
    this.child.stderr?.on('data', (chunk) => this.#onOutput('stderr', chunk))

    this.child.on('close', (code, signal) => {
      if (this.result) return // an 'error' already resolved this run
      this.finishedAt = Date.now()
      this.result = { code: code ?? 0, signal }
      this.#clearThreshold()
      this.emit('taskFinished', {
        code: code ?? 0,
        signal,
        durationMs: this.durationMs(),
      })
    })

    this.thresholdTimer = setTimeout(() => {
      if (this.result) return
      this.thresholdCrossed = true
      this.emit('thresholdCrossed', { elapsedMs: this.elapsedMs() })
    }, this.thresholdMs)
    // Never hold the event loop open just for the threshold timer.
    this.thresholdTimer.unref?.()

    this.emit('taskStarted', {
      command: this.command,
      args: this.args,
      startedAt: this.startedAt,
    })
    return this
  }

  // Capturing means the child writes to a pipe, and most tools turn colour off
  // when they see one. The output is still going to end up on a terminal, so we
  // ask for colour back. Anything the user has set themselves wins.
  #childEnv() {
    if (!this.forceColor) return process.env
    const env = { ...process.env }
    if (env.FORCE_COLOR === undefined) env.FORCE_COLOR = '1'
    if (env.CLICOLOR_FORCE === undefined) env.CLICOLOR_FORCE = '1'
    return env
  }

  #onOutput(stream, chunk) {
    this.writes += 1
    if (this.capturing) {
      this.buffer.push({ stream, chunk })
    } else {
      const target = stream === 'stdout' ? process.stdout : process.stderr
      target.write(chunk)
    }
    this.emit('output', { stream, chunk })
  }

  #clearThreshold() {
    if (this.thresholdTimer) {
      clearTimeout(this.thresholdTimer)
      this.thresholdTimer = null
    }
  }

  // While the TUI owns the screen, output is held rather than written through.
  startCapture() {
    this.capturing = true
  }

  stopCapture() {
    this.capturing = false
  }

  // Writes everything held back, in the exact order it arrived, to the same
  // stream it came from. This is the non-negotiable output-preservation step.
  flush() {
    const held = this.buffer
    this.buffer = []
    for (const { stream, chunk } of held) {
      const target = stream === 'stdout' ? process.stdout : process.stderr
      target.write(chunk)
    }
    return held.length
  }

  capturedText() {
    return Buffer.concat(this.buffer.map((entry) => entry.chunk)).toString('utf8')
  }

  elapsedMs() {
    return Date.now() - this.startedAt
  }

  durationMs() {
    return (this.finishedAt ?? Date.now()) - this.startedAt
  }

  signal(sig = 'SIGINT') {
    this.#clearThreshold()
    if (!this.child || this.result !== null) return
    if (this.detached && this.child.pid) {
      try {
        // Negative pid targets the whole process group.
        process.kill(-this.child.pid, sig)
        return
      } catch {
        // The group may already be gone; fall through to the direct kill.
      }
    }
    try {
      this.child.kill(sig)
    } catch {
      // already gone
    }
  }

  dispose() {
    this.#clearThreshold()
  }
}
