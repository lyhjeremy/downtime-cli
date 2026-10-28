import { bold, dim, green, red, gray } from './tui/ansi.js'

export function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) {
    // Sub-minute waits read better with one decimal.
    return ms < 10000 ? `${(ms / 1000).toFixed(1)}s` : `${totalSeconds}s`
  }
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function quoteCommand(command, args = []) {
  const parts = [command, ...args]
  return parts
    .map((part) => (/[\s"'$`\\*?|&;<>()]/.test(part) ? JSON.stringify(part) : part))
    .join(' ')
}

/**
 * The warm re-entry. Its whole job is one line that reminds you what you were
 * doing and how long you were away, so returning is not a cold start.
 */
export function buildRecap({ command, args, durationMs, exitCode, signal, contentSummary, width = 80 }) {
  const rule = dim('─'.repeat(Math.max(20, Math.min(width, 78))))
  const cmd = quoteCommand(command, args)
  const ok = exitCode === 0 && !signal
  const verdict = ok ? green('Done') : red('Failed')
  const outcome = signal ? `Killed by ${signal}` : `Exit code ${exitCode}`

  const lines = [
    rule,
    `${verdict} in ${bold(formatDuration(durationMs))}:  ${cmd}`,
  ]
  const meta = [outcome]
  if (contentSummary) meta.push(contentSummary)
  lines.push(gray(meta.join(' · ')))
  lines.push(rule)
  return lines.join('\n') + '\n'
}
