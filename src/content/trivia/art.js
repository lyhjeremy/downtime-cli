// Terminal picture rendering for the art rounds: flags, country outlines,
// landmark silhouettes.
//
// A picture is stored in the question bank as either
//   { palette: { R: 'red', W: 'white' }, rows: ['RRWW', 'RRWW'] }   colour grid
//   { rows: ['  /\\  ', ' /  \\ '] }                                line art
//
// A colour grid cell renders as two spaces on a coloured background, which
// comes out roughly square. On terminals without colour the grid falls back to
// shading characters by luminance, so a flag still reads as light and dark.

const BASIC_BG = {
  red: '41',
  green: '42',
  yellow: '43',
  blue: '44',
  magenta: '45',
  cyan: '46',
  white: '107',
  black: '40',
  gray: '100',
}

// Colours that need the 256-colour palette to look right, with a basic-colour
// stand-in chosen so lookalike flags stay distinguishable (Ireland's orange
// falls back to yellow, never to red, or it would collide with Italy).
const EXTENDED_BG = {
  orange: { ext: '48;5;208', basic: '43' },
  darkred: { ext: '48;5;88', basic: '41' },
  darkblue: { ext: '48;5;18', basic: '44' },
  lightblue: { ext: '48;5;117', basic: '46' },
}

// Monochrome fallback: shading by luminance so light areas stay light.
const MONO = {
  white: '░',
  yellow: '▒',
  orange: '▒',
  lightblue: '▒',
  cyan: '▒',
  red: '▓',
  green: '▓',
  magenta: '▓',
  gray: '▓',
  blue: '█',
  darkblue: '█',
  darkred: '█',
  black: '█',
}

export function detectColorDepth(env = process.env, isTTY = Boolean(process.stdout.isTTY)) {
  if (env.NO_COLOR || !isTTY) return 'mono'
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return '256'
  const term = env.TERM || ''
  if (term.includes('256color')) return '256'
  if (term === 'dumb' || term === '') return 'mono'
  return '16'
}

function bgCode(color, depth) {
  const extended = EXTENDED_BG[color]
  if (extended) return depth === '256' ? extended.ext : extended.basic
  return BASIC_BG[color] ?? BASIC_BG.gray
}

/**
 * Renders a picture to an array of plain strings (mono / line art) or strings
 * containing ANSI colour (grids on a colour terminal).
 */
export function renderArt(art, depth = detectColorDepth()) {
  if (!art || !Array.isArray(art.rows)) return []
  if (!art.palette) {
    // Line art passes through untouched; the caller decides its colour.
    return art.rows.slice()
  }
  const out = []
  for (const row of art.rows) {
    let line = ''
    if (depth === 'mono') {
      for (const key of row) {
        const color = art.palette[key]
        line += color ? (MONO[color] ?? '▓').repeat(2) : '  '
      }
    } else {
      let open = null
      for (const key of row) {
        const color = art.palette[key]
        const code = color ? bgCode(color, depth) : null
        if (code !== open) {
          if (open !== null) line += '\x1b[0m'
          if (code !== null) line += `\x1b[${code}m`
          open = code
        }
        line += '  '
      }
      if (open !== null) line += '\x1b[0m'
    }
    out.push(line)
  }
  return out
}

export function artWidth(art) {
  if (!art || !Array.isArray(art.rows)) return 0
  return Math.max(...art.rows.map((row) => row.length)) * (art.palette ? 2 : 1)
}
