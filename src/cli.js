import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadConfig, applyOverrides, configPath, stateDir } from './config.js'
import { runSession, registry } from './session.js'
import { bold, dim, cyan, yellow } from './tui/ansi.js'

const here = dirname(fileURLToPath(import.meta.url))

function version() {
  try {
    return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

const HELP = `${cyan('downtime')}: fill the wait, then land back on your feet

${bold('Usage')}
  downtime run <command> [args...]
  downtime run [options] -- <command> [args...]
  downtime config
  downtime --help | --version

${bold('Options for run')}
  -t, --threshold <seconds>   wait this long before downtime mode (default 5)
      --entry <auto|manual>   open automatically, or on a keypress
      --exit <immediate|finish_round>
                              snap back the instant the task ends, or let the
                              current question finish first
      --content <id>          content module to use (${registry.ids().join(', ')})

${bold('Examples')}
  downtime run claude -p "refactor the auth module"
  downtime run npm run build
  downtime run --threshold 15 --exit finish_round -- pytest -x

Config lives at ${dim(configPath())}
`

class UsageError extends Error {}

export function parseArgs(argv) {
  if (argv.length === 0) return { command: 'help' }
  const [first, ...rest] = argv

  if (first === '--version' || first === '-v') return { command: 'version' }
  if (first === '--help' || first === '-h' || first === 'help') return { command: 'help' }
  if (first === 'config') return { command: 'config', args: rest }
  if (first !== 'run') {
    throw new UsageError(`unknown command "${first}". Try: downtime run <command>`)
  }

  const overrides = {}
  let i = 0
  for (; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--') {
      i++
      break
    }
    if (!arg.startsWith('-')) break

    const takeValue = () => {
      const value = rest[++i]
      if (value === undefined) throw new UsageError(`${arg} needs a value`)
      return value
    }

    switch (arg) {
      case '-t':
      case '--threshold': {
        const seconds = Number(takeValue())
        if (!Number.isFinite(seconds) || seconds < 0) {
          throw new UsageError('--threshold needs a number of seconds')
        }
        overrides.entry = { ...overrides.entry, thresholdSeconds: seconds }
        break
      }
      case '--entry': {
        const mode = takeValue()
        if (!['auto', 'manual'].includes(mode)) {
          throw new UsageError('--entry must be auto or manual')
        }
        overrides.entry = { ...overrides.entry, mode }
        break
      }
      case '--exit': {
        const mode = takeValue()
        if (!['immediate', 'finish_round'].includes(mode)) {
          throw new UsageError('--exit must be immediate or finish_round')
        }
        overrides.exit = { mode }
        break
      }
      case '--content': {
        const id = takeValue()
        if (!registry.has(id)) {
          throw new UsageError(`unknown content module "${id}". Available: ${registry.ids().join(', ')}`)
        }
        overrides.content = { module: id }
        break
      }
      default:
        throw new UsageError(`unknown option "${arg}"`)
    }
  }

  const rem = rest.slice(i)
  if (rem.length === 0) throw new UsageError('downtime run needs a command to run')
  return { command: 'run', overrides, target: rem[0], targetArgs: rem.slice(1) }
}

export async function main(argv) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`downtime: ${err.message}\n`)
      process.exitCode = 2
      return 2
    }
    throw err
  }

  if (parsed.command === 'help') {
    process.stdout.write(HELP)
    return 0
  }
  if (parsed.command === 'version') {
    process.stdout.write(version() + '\n')
    return 0
  }

  const { config, created, warnings } = loadConfig()
  for (const warning of warnings) {
    process.stderr.write(yellow(`downtime: ${warning}`) + '\n')
  }

  if (parsed.command === 'config') {
    process.stdout.write(`${dim('config')}  ${configPath()}${created ? dim('  (just created)') : ''}\n`)
    process.stdout.write(`${dim('state')}   ${stateDir()}\n\n`)
    process.stdout.write(JSON.stringify(config, null, 2) + '\n')
    return 0
  }

  const effective = applyOverrides(config, parsed.overrides)
  const code = await runSession({
    command: parsed.target,
    args: parsed.targetArgs,
    config: effective,
  })
  process.exitCode = code
  return code
}
