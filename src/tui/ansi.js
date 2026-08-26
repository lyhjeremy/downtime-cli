// Raw terminal escape sequences. No dependencies on purpose: this tool has to be
// safe to `npx` and it must never leave someone's shell in a broken state.

export const ALT_ENTER = '\x1b[?1049h'
export const ALT_LEAVE = '\x1b[?1049l'
export const CURSOR_HIDE = '\x1b[?25l'
export const CURSOR_SHOW = '\x1b[?25h'
export const CURSOR_HOME = '\x1b[H'
export const CLEAR_SCREEN = '\x1b[2J'
export const CLEAR_LINE = '\x1b[2K\r'

const colorEnabled =
  !process.env.NO_COLOR &&
  process.env.TERM !== 'dumb' &&
  Boolean(process.stdout.isTTY)

const wrap = (open, close) => (s) =>
  colorEnabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s)

export const bold = wrap(1, 22)
export const dim = wrap(2, 22)
export const italic = wrap(3, 23)
export const underline = wrap(4, 24)
export const red = wrap(31, 39)
export const green = wrap(32, 39)
export const yellow = wrap(33, 39)
export const blue = wrap(34, 39)
export const magenta = wrap(35, 39)
export const cyan = wrap(36, 39)
export const gray = wrap(90, 39)

export const hasColor = () => colorEnabled

// Visible width, ignoring escape sequences. Good enough for the Latin text in
// the question bank; it does not attempt full east-asian width handling.
export function visibleLength(s) {
  return stripAnsi(s).length
}

export function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
}

// Word-wrap to width, preserving existing newlines.
export function wrapText(text, width) {
  const out = []
  for (const paragraph of String(text).split('\n')) {
    if (paragraph === '') {
      out.push('')
      continue
    }
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      if (line === '') {
        line = word
      } else if (visibleLength(line) + 1 + visibleLength(word) <= width) {
        line += ' ' + word
      } else {
        out.push(line)
        line = word
      }
    }
    if (line !== '') out.push(line)
  }
  return out
}

export function padEnd(s, width) {
  const pad = width - visibleLength(s)
  return pad > 0 ? s + ' '.repeat(pad) : s
}

export function center(s, width) {
  const pad = Math.max(0, width - visibleLength(s))
  const left = Math.floor(pad / 2)
  return ' '.repeat(left) + s
}
