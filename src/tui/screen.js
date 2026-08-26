import {
  ALT_ENTER,
  ALT_LEAVE,
  CURSOR_HIDE,
  CURSOR_SHOW,
  CURSOR_HOME,
  CLEAR_SCREEN,
} from './ansi.js'

/**
 * The presentation layer. Owns the alternate screen buffer, raw-mode keyboard
 * input, and terminal restoration. Content modules hand it strings; it knows
 * nothing about what those strings mean.
 *
 * Restoration is wired to every exit path there is. Leaving a terminal without
 * a cursor or stuck in raw mode is the worst thing a tool like this can do.
 */
export class Screen {
  constructor(options = {}) {
    this.out = options.out || process.stdout
    this.input = options.input || process.stdin
    this.active = false
    this.onKey = null
    this.cleanupHooks = []
  }

  get columns() {
    return this.out.columns || 80
  }

  get rows() {
    return this.out.rows || 24
  }

  enter(onKey) {
    if (this.active) return
    this.active = true
    this.onKey = onKey
    this.out.write(ALT_ENTER + CURSOR_HIDE + CLEAR_SCREEN + CURSOR_HOME)
    this.#attachInput()
    this.#attachSafetyNets()
  }

  render(frame) {
    if (!this.active) return
    // Repaint the whole frame. At one redraw per second plus keypresses this is
    // cheaper than tracking dirty regions, and it cannot drift out of sync.
    this.out.write(CURSOR_HOME + CLEAR_SCREEN + frame)
  }

  leave() {
    if (!this.active) return
    this.active = false
    this.#detachInput()
    this.out.write(CURSOR_SHOW + ALT_LEAVE)
    this.#detachSafetyNets()
  }

  // Safe to call from anywhere, including a crash handler.
  restore() {
    try {
      if (this.input.isTTY && this.input.setRawMode) this.input.setRawMode(false)
    } catch {}
    try {
      this.out.write(CURSOR_SHOW + (this.active ? ALT_LEAVE : ''))
    } catch {}
    this.active = false
  }

  onResize(handler) {
    this.out.on('resize', handler)
    this.cleanupHooks.push(() => this.out.off('resize', handler))
  }

  #attachInput() {
    if (this.input.isTTY && this.input.setRawMode) this.input.setRawMode(true)
    this.input.resume()
    this.input.setEncoding('utf8')
    this.input.on('data', this.#handleKey)
  }

  #detachInput() {
    this.input.off('data', this.#handleKey)
    try {
      if (this.input.isTTY && this.input.setRawMode) this.input.setRawMode(false)
    } catch {}
    this.input.pause()
    for (const hook of this.cleanupHooks.splice(0)) hook()
  }

  // Arrow-function fields rather than methods: these are added and removed as
  // listeners, so each needs a stable identity.
  #handleKey = (data) => {
    if (this.onKey) this.onKey(String(data))
  }

  #attachSafetyNets() {
    process.on('exit', this.#exitHook)
    process.on('uncaughtException', this.#restoreAndRethrow)
  }

  #detachSafetyNets() {
    process.off('exit', this.#exitHook)
    process.off('uncaughtException', this.#restoreAndRethrow)
  }

  #exitHook = () => this.restore()

  #restoreAndRethrow = (err) => {
    this.restore()
    process.off('uncaughtException', this.#restoreAndRethrow)
    throw err
  }
}
